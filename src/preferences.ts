import { PREFERENCE_PANE_ID } from "./config";
import type { LocalDictionaryService } from "./dictionary/service";
import { parseDictionaryPaths } from "./dictionary/paths";
import {
  getManagedDictionaryDirectory,
  importDictionaryFiles,
} from "./dictionary/storage";
import { translateWithOpenAI } from "./openai";
import {
  loadSettings,
  setPref,
  type PluginSettings,
  type PrefKey,
} from "./prefs";

type PreferenceDocument = Document & {
  defaultView: (Window & { browsingContext: BrowsingContext }) | null;
};

function control<T extends Element>(doc: Document, id: string): T {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Missing preference control: ${id}`);
  return element as unknown as T;
}

export class PreferencesController {
  constructor(private readonly dictionaries: LocalDictionaryService) {}

  onLoad(event: Event): void {
    const root = event.currentTarget as HTMLElement;
    const doc = root.ownerDocument;
    if (root.dataset.lexiflowInitialized === "true") return;
    root.dataset.lexiflowInitialized = "true";
    const settings = loadSettings();

    this.bindCheckbox(
      doc,
      "lft-auto-word",
      "autoTranslateWord",
      settings.autoTranslateWord,
    );
    this.bindCheckbox(
      doc,
      "lft-auto-paragraph",
      "autoTranslateParagraph",
      settings.autoTranslateParagraph,
    );
    this.bindText(
      doc,
      "lft-dictionary-paths",
      "dictionaryPaths",
      settings.dictionaryPaths,
      () => this.dictionaries.reset(),
    );
    this.bindText(
      doc,
      "lft-openai-endpoint",
      "openaiEndpoint",
      settings.openaiEndpoint,
    );
    this.bindText(
      doc,
      "lft-openai-api-key",
      "openaiApiKey",
      settings.openaiApiKey,
    );
    this.bindText(doc, "lft-openai-model", "openaiModel", settings.openaiModel);
    this.bindText(
      doc,
      "lft-target-language",
      "targetLanguage",
      settings.targetLanguage,
    );
    this.bindText(
      doc,
      "lft-openai-temperature",
      "openaiTemperature",
      settings.openaiTemperature,
    );
    this.bindText(
      doc,
      "lft-openai-prompt",
      "openaiPrompt",
      settings.openaiPrompt,
    );

    control(doc, "lft-import-dictionaries").addEventListener("command", () => {
      void this.selectDictionaryFiles(doc as PreferenceDocument, true);
    });
    control(doc, "lft-pick-dictionaries").addEventListener("command", () => {
      void this.selectDictionaryFiles(doc as PreferenceDocument, false);
    });
    control(doc, "lft-open-dictionary-folder").addEventListener(
      "command",
      () => {
        void this.openManagedDictionaryDirectory(doc);
      },
    );
    const managedDirectory = control<HTMLElement>(
      doc,
      "lft-managed-dictionary-directory",
    );
    managedDirectory.textContent = getManagedDictionaryDirectory();
    managedDirectory.title = getManagedDictionaryDirectory();
    control(doc, "lft-clear-dictionaries").addEventListener("command", () => {
      const paths = control<HTMLTextAreaElement>(doc, "lft-dictionary-paths");
      paths.value = "";
      setPref("dictionaryPaths", "");
      this.dictionaries.reset();
      this.setStatus(doc, "已清空本地词典列表", "ok");
    });
    control(doc, "lft-test-openai").addEventListener("command", () => {
      void this.testOpenAI(doc);
    });

    const count = parseDictionaryPaths(settings.dictionaryPaths).filter(
      (path) => /\.mdx$/iu.test(path),
    ).length;
    this.setStatus(
      doc,
      count > 0 ? `已配置 ${count} 部 MDX 词典` : "尚未配置本地词典",
      count > 0 ? "ok" : "",
    );
  }

  open(): void {
    Zotero.Utilities.Internal.openPreferences(PREFERENCE_PANE_ID);
  }

  private bindCheckbox(
    doc: Document,
    id: string,
    key: "autoTranslateWord" | "autoTranslateParagraph",
    value: boolean,
  ): void {
    const checkbox = control<Element & { checked: boolean }>(doc, id);
    checkbox.checked = value;
    checkbox.addEventListener("command", () => {
      setPref(key, checkbox.checked);
    });
  }

  private bindText<
    K extends Exclude<PrefKey, "autoTranslateWord" | "autoTranslateParagraph">,
  >(
    doc: Document,
    id: string,
    key: K,
    value: PluginSettings[K],
    onChange?: () => void,
  ): void {
    const input = control<HTMLInputElement | HTMLTextAreaElement>(doc, id);
    input.value = String(value);
    input.addEventListener("change", () => {
      setPref(key, input.value);
      onChange?.();
    });
  }

  private saveAll(doc: Document): PluginSettings {
    const current = loadSettings();
    const settings: PluginSettings = {
      ...current,
      autoTranslateWord: control<Element & { checked: boolean }>(
        doc,
        "lft-auto-word",
      ).checked,
      autoTranslateParagraph: control<Element & { checked: boolean }>(
        doc,
        "lft-auto-paragraph",
      ).checked,
      dictionaryPaths: control<HTMLTextAreaElement>(doc, "lft-dictionary-paths")
        .value,
      openaiEndpoint: control<HTMLInputElement>(doc, "lft-openai-endpoint")
        .value,
      openaiApiKey: control<HTMLInputElement>(doc, "lft-openai-api-key").value,
      openaiModel: control<HTMLInputElement>(doc, "lft-openai-model").value,
      targetLanguage: control<HTMLInputElement>(doc, "lft-target-language")
        .value,
      openaiTemperature: control<HTMLInputElement>(
        doc,
        "lft-openai-temperature",
      ).value,
      openaiPrompt: control<HTMLTextAreaElement>(doc, "lft-openai-prompt")
        .value,
    };
    for (const [key, value] of Object.entries(settings)) {
      setPref(key as PrefKey, value as never);
    }
    return settings;
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
    let added = selected;
    if (importToManagedDirectory) {
      this.setStatus(
        doc,
        "正在复制词典到 Zotero 数据目录，大型词典可能需要一些时间…",
        "",
      );
      try {
        added = await importDictionaryFiles(selected);
      } catch (error) {
        this.setStatus(
          doc,
          `导入失败：${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
    }

    const paths = control<HTMLTextAreaElement>(doc, "lft-dictionary-paths");
    const normalized = parseDictionaryPaths(
      [...parseDictionaryPaths(paths.value), ...added].join("\n"),
    );
    paths.value = normalized.join("\n");
    setPref("dictionaryPaths", paths.value);
    this.dictionaries.reset();
    const mdxCount = normalized.filter((path) => /\.mdx$/iu.test(path)).length;
    this.setStatus(
      doc,
      mdxCount > 0
        ? importToManagedDirectory
          ? `导入完成：已配置 ${mdxCount} 部 MDX 词典，相关 MDD 已一并复制`
          : `已配置 ${mdxCount} 部 MDX 词典（使用外部文件路径）`
        : "请选择至少一个 .mdx 文件",
      mdxCount > 0 ? "ok" : "error",
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
      this.setStatus(
        doc,
        `无法打开词典目录：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private async testOpenAI(doc: Document): Promise<void> {
    const button = control<Element & { disabled: boolean }>(
      doc,
      "lft-test-openai",
    );
    const settings = this.saveAll(doc);
    button.disabled = true;
    this.setStatus(doc, "正在测试接口…", "");
    try {
      const result = await translateWithOpenAI(
        "Translate this short connection test into the target language.",
        settings,
      );
      const preview = result.text.replace(/\s+/gu, " ").slice(0, 72);
      this.setStatus(doc, `连接成功（${result.model}）：${preview}`, "ok");
    } catch (error) {
      this.setStatus(
        doc,
        `连接失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      button.disabled = false;
    }
  }
}
