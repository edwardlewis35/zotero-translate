import { PREFERENCE_PANE_ID } from "./config";
import {
  discoverSiblingMDDPaths,
  groupDictionaryPaths,
  parseDictionaryPaths,
  pathParts,
} from "./dictionary/paths";
import type { LocalDictionaryService } from "./dictionary/service";
import {
  getManagedDictionaryDirectory,
  importDictionaryFiles,
} from "./dictionary/storage";
import { translateWithOpenAI } from "./openai";
import {
  createConfigID,
  DEFAULT_PROMPT,
  getPref,
  loadAPIProfiles,
  loadDictionaryConfigs,
  saveAPIProfiles,
  saveDictionaryConfigs,
  selectAPIProfile,
  setPref,
  type APIProfile,
  type DictionaryConfig,
} from "./prefs";

type PreferenceDocument = Document & {
  defaultView: (Window & { browsingContext: BrowsingContext }) | null;
};

const HTML_NS = "http://www.w3.org/1999/xhtml";

function control<T extends Element>(doc: Document, id: string): T {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Missing preference control: ${id}`);
  return element as unknown as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PreferencesController {
  private dictionaryConfigs: DictionaryConfig[] = [];
  private apiProfiles: APIProfile[] = [];

  constructor(private readonly dictionaries: LocalDictionaryService) {}

  onLoad(event: Event): void {
    const root = event.currentTarget as HTMLElement;
    const doc = root.ownerDocument;
    if (root.dataset.lexiflowInitialized === "true") return;
    root.dataset.lexiflowInitialized = "true";

    this.bindCheckbox(
      doc,
      "lft-auto-word",
      "autoTranslateWord",
      getPref("autoTranslateWord"),
    );
    this.bindCheckbox(
      doc,
      "lft-auto-paragraph",
      "autoTranslateParagraph",
      getPref("autoTranslateParagraph"),
    );
    this.bindCheckbox(
      doc,
      "lft-load-audio",
      "loadDictionaryAudio",
      getPref("loadDictionaryAudio"),
    );

    this.dictionaryConfigs = loadDictionaryConfigs();
    this.apiProfiles = loadAPIProfiles();
    // Persist migrated 0.2.x settings in the new structured format.
    saveDictionaryConfigs(this.dictionaryConfigs);
    this.apiProfiles = saveAPIProfiles(this.apiProfiles);

    this.renderDictionaryConfigs(doc);
    this.renderAPIProfiles(doc);

    control(doc, "lft-add-dictionary").addEventListener("click", () => {
      void this.selectDictionaryFiles(doc as PreferenceDocument, true);
    });
    control(doc, "lft-add-external-dictionary").addEventListener(
      "click",
      () => {
        void this.selectDictionaryFiles(doc as PreferenceDocument, false);
      },
    );
    control(doc, "lft-open-dictionary-folder").addEventListener("click", () => {
      void this.openManagedDictionaryDirectory(doc);
    });
    control(doc, "lft-add-api-profile").addEventListener("click", () => {
      this.addAPIProfile(doc);
    });

    const managedDirectory = control<HTMLElement>(
      doc,
      "lft-managed-dictionary-directory",
    );
    managedDirectory.textContent = getManagedDictionaryDirectory();
    managedDirectory.title = getManagedDictionaryDirectory();

    const enabledCount = this.dictionaryConfigs.filter(
      (config) => config.enabled,
    ).length;
    this.setStatus(
      doc,
      enabledCount > 0
        ? `已配置 ${this.dictionaryConfigs.length} 部词典，其中 ${enabledCount} 部已启用`
        : "尚未配置或启用本地词典",
      enabledCount > 0 ? "ok" : "",
    );
  }

  open(): void {
    Zotero.Utilities.Internal.openPreferences(PREFERENCE_PANE_ID);
  }

  private html<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
    className = "",
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const element = doc.createElementNS(
      HTML_NS,
      tag,
    ) as HTMLElementTagNameMap[K];
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  private bindCheckbox(
    doc: Document,
    id: string,
    key: "autoTranslateWord" | "autoTranslateParagraph" | "loadDictionaryAudio",
    value: boolean,
  ): void {
    const checkbox = control<Element & { checked: boolean }>(doc, id);
    checkbox.checked = value;
    checkbox.addEventListener("command", () => {
      setPref(key, checkbox.checked);
      if (key === "loadDictionaryAudio") {
        if (!checkbox.checked) this.dictionaries.releaseAudio();
        this.setStatus(
          doc,
          checkbox.checked
            ? "发音已开启：重新查词后可点击播放，届时才读取 MDD"
            : "发音已关闭：不读取 MDD，词典释义和音标不受影响",
          "ok",
        );
      }
    });
  }

  private setStatus(
    doc: Document,
    message: string,
    kind: "ok" | "error" | "",
  ): void {
    const status = control<HTMLElement>(doc, "lft-settings-status");
    status.textContent = message;
    status.dataset.kind = kind;
  }

  private saveDictionaryState(doc: Document, message?: string): void {
    saveDictionaryConfigs(this.dictionaryConfigs);
    this.dictionaries.configurationChanged();
    this.renderDictionaryConfigs(doc);
    if (message) this.setStatus(doc, message, "ok");
  }

  private renderDictionaryConfigs(doc: Document): void {
    const list = control<HTMLElement>(doc, "lft-dictionary-list");
    list.replaceChildren();
    if (this.dictionaryConfigs.length === 0) {
      const empty = this.html(doc, "div", "lft-config-empty");
      empty.append(
        this.html(doc, "div", "lft-config-empty-icon", "＋"),
        this.html(doc, "strong", "", "还没有本地词典"),
        this.html(
          doc,
          "span",
          "",
          "点击右上角“＋ 添加词典”，每部词典会单独显示和配置。",
        ),
      );
      list.append(empty);
      return;
    }

    for (const config of this.dictionaryConfigs) {
      const card = this.html(
        doc,
        "article",
        `lft-dictionary-config${config.enabled ? "" : " is-disabled"}`,
      );
      const header = this.html(doc, "div", "lft-config-header");
      const identity = this.html(doc, "div", "lft-config-identity");
      const name = this.html(doc, "input", "lft-config-name");
      name.type = "text";
      name.value = config.name;
      name.placeholder = "词典显示名称";
      name.addEventListener("input", () => {
        config.name =
          name.value.trim() ||
          pathParts(config.mdxPath).filename.replace(/\.mdx$/iu, "");
        saveDictionaryConfigs(this.dictionaryConfigs);
        this.dictionaries.configurationChanged();
      });
      identity.append(this.html(doc, "span", "lft-config-badge", "MDX"), name);

      const controls = this.html(doc, "div", "lft-config-controls");
      const enabledLabel = this.html(doc, "label", "lft-enable-control");
      const enabled = this.html(doc, "input");
      enabled.type = "checkbox";
      enabled.checked = config.enabled;
      enabled.addEventListener("change", () => {
        config.enabled = enabled.checked;
        this.saveDictionaryState(
          doc,
          `已${config.enabled ? "启用" : "停用"}词典：${config.name}`,
        );
      });
      enabledLabel.append(enabled, this.html(doc, "span", "", "启用"));

      const remove = this.html(doc, "button", "lft-icon-button", "删除");
      remove.type = "button";
      remove.title = `移除词典配置：${config.name}`;
      remove.addEventListener("click", () => {
        this.dictionaryConfigs = this.dictionaryConfigs.filter(
          (item) => item.id !== config.id,
        );
        this.saveDictionaryState(doc, `已移除词典配置：${config.name}`);
      });
      controls.append(enabledLabel, remove);
      header.append(identity, controls);

      const path = this.html(doc, "div", "lft-config-path-row");
      path.append(
        this.html(doc, "span", "lft-config-path-label", "词典文件"),
        this.html(doc, "code", "lft-config-path", config.mdxPath),
      );
      (path.lastElementChild as HTMLElement).title = config.mdxPath;

      const resources = this.html(doc, "div", "lft-config-resources");
      resources.append(
        this.html(
          doc,
          "span",
          "lft-resource-summary",
          config.mddPaths.length > 0
            ? `已关联 ${config.mddPaths.length} 个 MDD 资源文件`
            : "没有关联 MDD 资源文件",
        ),
      );
      for (const mddPath of config.mddPaths) {
        const chip = this.html(
          doc,
          "span",
          "lft-resource-chip",
          pathParts(mddPath).filename,
        );
        chip.title = mddPath;
        resources.append(chip);
      }

      card.append(header, path, resources);
      list.append(card);
    }
  }

  private newAPIProfile(): APIProfile {
    const index = this.apiProfiles.length + 1;
    return {
      id: createConfigID("model"),
      name: `模型 ${index}`,
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "",
      temperature: "0.2",
      targetLanguage: "简体中文",
      prompt: DEFAULT_PROMPT,
    };
  }

  private addAPIProfile(doc: Document): void {
    const profile = this.newAPIProfile();
    this.apiProfiles.push(profile);
    this.apiProfiles = saveAPIProfiles(this.apiProfiles);
    selectAPIProfile(profile.id);
    this.renderAPIProfiles(doc);
    this.setStatus(doc, "已增加一个模型 API 配置", "ok");
  }

  private profileField(
    doc: Document,
    profile: APIProfile,
    key: keyof Pick<
      APIProfile,
      | "name"
      | "endpoint"
      | "apiKey"
      | "model"
      | "temperature"
      | "targetLanguage"
      | "prompt"
    >,
    labelText: string,
    options: {
      type?: string;
      placeholder?: string;
      multiline?: boolean;
      wide?: boolean;
    } = {},
  ): HTMLElement {
    const field = this.html(
      doc,
      "label",
      `lft-profile-field${options.wide ? " is-wide" : ""}`,
    );
    field.append(this.html(doc, "span", "lft-profile-label", labelText));
    const input = options.multiline
      ? this.html(doc, "textarea", "lft-profile-input lft-profile-prompt")
      : this.html(doc, "input", "lft-profile-input");
    if (input.tagName.toLocaleLowerCase() === "input") {
      const htmlInput = input as HTMLInputElement;
      htmlInput.type = options.type || "text";
      if (key === "temperature") {
        htmlInput.min = "0";
        htmlInput.max = "2";
        htmlInput.step = "0.1";
      }
      if (key === "apiKey") htmlInput.autocomplete = "off";
    }
    input.value = profile[key];
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener("input", () => {
      profile[key] = input.value;
      saveAPIProfiles(this.apiProfiles);
    });
    field.append(input);
    return field;
  }

  private renderAPIProfiles(doc: Document): void {
    const list = control<HTMLElement>(doc, "lft-api-profile-list");
    list.replaceChildren();
    const selectedID = getPref("selectedApiProfileId");

    for (const profile of this.apiProfiles) {
      const card = this.html(
        doc,
        "article",
        `lft-api-profile${profile.id === selectedID ? " is-selected" : ""}`,
      );
      const header = this.html(doc, "div", "lft-api-profile-header");
      const defaultLabel = this.html(doc, "label", "lft-profile-default");
      const radio = this.html(doc, "input");
      radio.type = "radio";
      radio.name = "lft-default-api-profile";
      radio.value = profile.id;
      radio.checked = profile.id === selectedID;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        selectAPIProfile(profile.id);
        this.renderAPIProfiles(doc);
        this.setStatus(doc, `已将“${profile.name}”设为默认翻译模型`, "ok");
      });
      defaultLabel.append(
        radio,
        this.html(doc, "span", "", radio.checked ? "当前默认" : "设为默认"),
      );
      const title = this.html(doc, "div", "lft-api-profile-title");
      title.append(
        this.html(doc, "span", "lft-config-badge is-model", "AI"),
        this.html(
          doc,
          "strong",
          "",
          profile.name || profile.model || "未命名模型",
        ),
        this.html(
          doc,
          "span",
          "lft-profile-model-summary",
          profile.model || "尚未填写模型名称",
        ),
      );

      const headerActions = this.html(doc, "div", "lft-config-controls");
      const test = this.html(doc, "button", "lft-secondary-button", "测试连接");
      test.type = "button";
      test.addEventListener("click", () => {
        void this.testOpenAI(doc, profile, test);
      });
      const remove = this.html(doc, "button", "lft-icon-button", "删除");
      remove.type = "button";
      remove.disabled = this.apiProfiles.length <= 1;
      remove.title =
        this.apiProfiles.length <= 1
          ? "至少保留一个 API 配置"
          : `删除 API 配置：${profile.name}`;
      remove.addEventListener("click", () => {
        if (this.apiProfiles.length <= 1) return;
        this.apiProfiles = this.apiProfiles.filter(
          (item) => item.id !== profile.id,
        );
        this.apiProfiles = saveAPIProfiles(this.apiProfiles);
        this.renderAPIProfiles(doc);
        this.setStatus(doc, `已删除 API 配置：${profile.name}`, "ok");
      });
      headerActions.append(defaultLabel, test, remove);
      header.append(title, headerActions);

      const fields = this.html(doc, "div", "lft-profile-grid");
      fields.append(
        this.profileField(doc, profile, "name", "配置名称", {
          placeholder: "例如：OpenAI、DeepSeek、本地模型",
        }),
        this.profileField(doc, profile, "model", "模型名称", {
          placeholder: "例如：gpt-4o-mini",
        }),
        this.profileField(doc, profile, "endpoint", "接口地址", {
          type: "url",
          placeholder: "https://api.example.com/v1/chat/completions",
          wide: true,
        }),
        this.profileField(doc, profile, "apiKey", "API Key", {
          type: "password",
          placeholder: "本地服务不需要时可留空",
          wide: true,
        }),
        this.profileField(doc, profile, "targetLanguage", "目标语言", {
          placeholder: "简体中文",
        }),
        this.profileField(doc, profile, "temperature", "Temperature", {
          type: "number",
        }),
        this.profileField(doc, profile, "prompt", "提示词", {
          multiline: true,
          wide: true,
        }),
      );
      card.append(header, fields);
      list.append(card);
    }
  }

  private async selectDictionaryFiles(
    doc: PreferenceDocument,
    importToManagedDirectory: boolean,
  ): Promise<void> {
    const win = doc.defaultView;
    if (!win) return;
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker,
    );
    picker.init(
      win.browsingContext,
      "选择 MDX/MDD 词典文件",
      Ci.nsIFilePicker.modeOpenMultiple,
    );
    picker.appendFilter("MDict 词典文件 (*.mdx, *.mdd)", "*.mdx;*.mdd");

    const result = await new Promise<nsIFilePicker.ResultCode>((resolve) => {
      picker.open(resolve);
    });
    if (result !== Ci.nsIFilePicker.returnOK) return;

    const selected: string[] = [];
    const files = picker.files;
    while (files.hasMoreElements()) {
      selected.push(files.getNext().QueryInterface!(Ci.nsIFile).path);
    }

    let added = parseDictionaryPaths(selected.join("\n"));
    if (importToManagedDirectory) {
      this.setStatus(
        doc,
        "正在复制词典到 Zotero 数据目录，大型词典可能需要一些时间…",
        "",
      );
      try {
        added = await importDictionaryFiles(added);
      } catch (error) {
        this.setStatus(doc, `导入失败：${errorMessage(error)}`, "error");
        return;
      }
    }

    const expanded = await discoverSiblingMDDPaths(added);
    const selectedMDX = new Set(
      added
        .filter((path) => /\.mdx$/iu.test(path))
        .map((path) => path.toLocaleLowerCase()),
    );
    const groups = groupDictionaryPaths(expanded).filter((group) =>
      selectedMDX.has(group.mdxPath.toLocaleLowerCase()),
    );
    if (groups.length === 0) {
      this.setStatus(doc, "请选择至少一个 .mdx 文件", "error");
      return;
    }

    for (const group of groups) {
      const existing = this.dictionaryConfigs.find(
        (item) =>
          item.mdxPath.toLocaleLowerCase() ===
          group.mdxPath.toLocaleLowerCase(),
      );
      if (existing) {
        existing.mddPaths = group.mddPaths;
        existing.enabled = true;
      } else {
        this.dictionaryConfigs.push({
          id: createConfigID("dictionary"),
          name: group.name,
          mdxPath: group.mdxPath,
          mddPaths: group.mddPaths,
          enabled: true,
        });
      }
    }
    this.saveDictionaryState(
      doc,
      importToManagedDirectory
        ? `导入完成：新增或更新 ${groups.length} 部词典`
        : `已添加 ${groups.length} 部外部词典`,
    );
  }

  private async openManagedDictionaryDirectory(doc: Document): Promise<void> {
    const directory = getManagedDictionaryDirectory();
    try {
      await IOUtils.makeDirectory(directory, {
        createAncestors: true,
        ignoreExisting: true,
      });
      Zotero.launchFile(directory);
    } catch (error) {
      this.setStatus(doc, `无法打开词典目录：${errorMessage(error)}`, "error");
    }
  }

  private async testOpenAI(
    doc: Document,
    profile: APIProfile,
    button: HTMLButtonElement,
  ): Promise<void> {
    this.apiProfiles = saveAPIProfiles(this.apiProfiles);
    button.disabled = true;
    button.textContent = "连接中…";
    this.setStatus(doc, `正在测试“${profile.name}”…`, "");
    try {
      const result = await translateWithOpenAI(
        "Translate this short connection test into the target language.",
        {
          profile,
          onProgress: (progress) => {
            const preview = progress.text.replace(/\s+/gu, " ").slice(0, 72);
            this.setStatus(
              doc,
              `正在接收（${profile.name}）：${preview || "等待首个内容块…"}`,
              "",
            );
          },
        },
      );
      const preview = result.text.replace(/\s+/gu, " ").slice(0, 72);
      this.setStatus(
        doc,
        `连接成功（${profile.name} / ${result.model}）：${preview}`,
        "ok",
      );
    } catch (error) {
      this.setStatus(doc, `连接失败：${errorMessage(error)}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "测试连接";
    }
  }
}
