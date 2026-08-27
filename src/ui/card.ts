import readerStyles from "../../addon/chrome/content/reader.css";
import type { LocalDictionaryService } from "../dictionary/service";
import type {
  AudioAsset,
  DictionaryEntry,
  LocalLookupResult,
} from "../dictionary/types";
import { translateWithOpenAI } from "../openai";
import { getPref } from "../prefs";

const STYLE_ID = "lexiflowdicttranslator-reader-style";

function compactSelection(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function translationLines(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+\n/gu, "\n")
    .trim();
  let lines = normalized
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 1 && (lines[0]?.length || 0) > 90) {
    const sentenceLines =
      lines[0]
        ?.match(/[^。！？!?；;]+[。！？!?；;]?/gu)
        ?.map((line) => line.trim()) || [];
    if (sentenceLines.length > 1) lines = sentenceLines;
  }
  return lines.length > 0 ? lines : [text];
}

export function ensureReaderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = readerStyles;
  (doc.head || doc.documentElement).appendChild(style);
}

export class TranslationCard {
  readonly root: HTMLDivElement;
  private requestID = 0;
  private queryText: string;

  constructor(
    private readonly doc: Document,
    private readonly text: string,
    private readonly isWord: boolean,
    private readonly dictionaries: LocalDictionaryService,
    private readonly openSettings: () => void,
    private readonly saveAnnotation?: (translation: string) => Promise<void>,
  ) {
    this.queryText = text;
    ensureReaderStyles(doc);
    this.root = doc.createElement("div");
    this.root.className = "lft-card";
    this.root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
  }

  start(): void {
    if (this.isWord) {
      if (getPref("autoTranslateWord")) {
        void this.lookupLocal();
      } else {
        this.renderIdle(
          "W",
          "自动查词已关闭",
          "可以手动查询本地词典，或直接使用大模型翻译。",
          true,
        );
      }
      return;
    }
    if (getPref("autoTranslateParagraph")) {
      void this.translateOnline();
    } else {
      this.renderIdle(
        "译",
        "已选中句子或段落",
        "点击按钮后使用已配置的 OpenAI-compatible 接口翻译。",
        false,
      );
    }
  }

  private element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  private button(
    text: string,
    callback: () => void,
    primary = false,
    title = "",
  ): HTMLButtonElement {
    const button = this.element(
      "button",
      primary ? "lft-button lft-button-primary" : "lft-button",
      text,
    );
    button.type = "button";
    if (title) button.title = title;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback();
    });
    return button;
  }

  private frame(
    subtitle: string,
    body: HTMLElement,
    actions: HTMLElement[] = [],
  ): void {
    const header = this.element("div", "lft-card-header");
    const titleWrap = this.element("div", "lft-card-title-wrap");
    titleWrap.append(this.element("div", "lft-card-mark", "L"));
    const heading = this.element("div", "lft-card-heading");
    heading.append(
      this.element(
        "div",
        "lft-card-title",
        compactSelection(this.isWord ? this.queryText : this.text),
      ),
      this.element("div", "lft-card-subtitle", subtitle),
    );
    titleWrap.append(heading);
    header.append(titleWrap);
    if (actions.length > 0) {
      const actionWrap = this.element("div", "lft-card-actions");
      actionWrap.append(...actions);
      header.append(actionWrap);
    }
    const bodyWrap = this.element("div", "lft-card-body");
    bodyWrap.append(body);
    this.root.replaceChildren(header, bodyWrap);
  }

  private renderIdle(
    icon: string,
    title: string,
    detail: string,
    localAvailable: boolean,
  ): void {
    const state = this.element("div", "lft-state");
    const content = this.element("div");
    content.append(
      this.element("div", "lft-state-icon", icon),
      this.element("div", "lft-state-title", title),
      this.element("div", "lft-state-detail", detail),
    );
    const actions = this.element("div", "lft-state-actions");
    if (localAvailable) {
      actions.append(
        this.button("查询本地词典", () => void this.lookupLocal(), true),
      );
    }
    actions.append(
      this.button(
        "使用大模型翻译",
        () => void this.translateOnline(),
        !localAvailable,
      ),
    );
    content.append(actions);
    state.append(content);
    this.frame(localAvailable ? "等待查询" : "在线翻译", state);
  }

  private renderLoading(label: string, subtitle: string): void {
    const state = this.element("div", "lft-state");
    const content = this.element("div");
    content.append(
      this.element("div", "lft-spinner"),
      this.element("div", "lft-state-title", label),
      this.element(
        "div",
        "lft-state-detail",
        subtitle === "本地词典"
          ? "首次加载大型词典可能需要几秒。"
          : "正在等待接口响应…",
      ),
    );
    state.append(content);
    this.frame(subtitle, state);
  }

  private audioButton(audio: AudioAsset): HTMLButtonElement {
    const button = this.element("button", "lft-audio", "▶");
    button.type = "button";
    button.title = `播放：${audio.label}`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const player = this.doc.createElement("audio");
      player.src = audio.url;
      player.hidden = true;
      player.addEventListener("ended", () => player.remove());
      player.addEventListener("error", () => player.remove());
      this.root.append(player);
      void player.play().catch(() => player.remove());
    });
    return button;
  }

  private renderPronunciations(entry: DictionaryEntry): HTMLElement {
    const list = this.element("ul", "lft-pronunciations");
    entry.pronunciations.forEach((pronunciation, index) => {
      const item = this.element("li", "lft-pronunciation");
      item.append(
        this.element("span", "lft-pron-region", pronunciation.region),
        this.element("span", "lft-pron-text", pronunciation.text),
      );
      const audio =
        entry.audio.find((value) => value.region === pronunciation.region) ||
        entry.audio[index];
      if (audio) item.append(this.audioButton(audio));
      list.append(item);
    });
    if (entry.pronunciations.length === 0 && entry.audio.length > 0) {
      for (const audio of entry.audio) {
        const item = this.element("li", "lft-pronunciation");
        item.append(
          this.element("span", "lft-pron-region", audio.region),
          this.element("span", "lft-pron-text", audio.label),
          this.audioButton(audio),
        );
        list.append(item);
      }
    }
    return list;
  }

  private renderDictionary(entry: DictionaryEntry): HTMLElement {
    const section = this.element("section", "lft-dictionary");
    const header = this.element("div", "lft-dictionary-header");
    const identity = this.element("div", "lft-dictionary-identity");
    identity.append(
      this.element("div", "lft-dictionary-headword", entry.headword),
      this.renderPronunciations(entry),
    );
    header.append(
      identity,
      this.element("div", "lft-dictionary-name", entry.source),
    );
    section.append(header);

    const senses = this.element("div", "lft-senses");
    entry.senses.forEach((sense, index) => {
      const row = this.element("div", "lft-sense");
      const meta = this.element("div", "lft-sense-meta");
      const number =
        sense.number || (entry.senses.length > 1 ? String(index + 1) : "");
      if (number) {
        meta.append(this.element("span", "lft-sense-number", number));
      }
      if (sense.partOfSpeech) {
        meta.append(this.element("span", "lft-pos", sense.partOfSpeech));
      }
      const body = this.element("div", "lft-sense-content");
      const lines =
        sense.lines.length > 0
          ? sense.lines
          : translationLines(sense.translation).map((text) => ({
              text,
              kind: "mixed" as const,
            }));
      for (const line of lines) {
        body.append(
          this.element(
            "div",
            `lft-sense-line lft-line-${line.kind}`,
            line.text,
          ),
        );
      }
      if (meta.childElementCount > 0) row.append(meta);
      row.append(body);
      senses.append(row);
    });
    section.append(senses);

    if (entry.tags.length > 0) {
      const tags = this.element("div", "lft-tags");
      for (const tag of entry.tags) {
        tags.append(this.element("span", "lft-tag", tag));
      }
      section.append(tags);
    }
    if (entry.forms.length > 0) {
      const forms = this.element("div", "lft-forms");
      for (const form of entry.forms) {
        const item = this.element("span", "lft-form");
        item.append(
          this.element("span", "lft-form-label", form.label),
          this.element("span", "lft-form-value", form.value),
        );
        forms.append(item);
      }
      section.append(forms);
    }
    section.append(
      this.element("div", "lft-source", `来自 ${entry.source} 本地词典`),
    );
    return section;
  }

  private localAnnotationText(result: LocalLookupResult): string {
    const dictionaries = result.entries.map((entry) => {
      const senses = entry.senses.map((sense, index) => {
        const label = [
          sense.number || (entry.senses.length > 1 ? String(index + 1) : ""),
          sense.partOfSpeech,
        ]
          .filter(Boolean)
          .join(" ");
        const text = (
          sense.lines.length > 0
            ? sense.lines.map((line) => line.text)
            : [sense.translation]
        ).join("\n");
        return label ? `${label} ${text}` : text;
      });
      return [`${entry.headword} · ${entry.source}`, ...senses].join("\n");
    });
    return dictionaries.join("\n\n").slice(0, 12000);
  }

  private annotationButton(translation: string): HTMLButtonElement | null {
    const saveAnnotation = this.saveAnnotation;
    if (!saveAnnotation) return null;
    let button: HTMLButtonElement;
    button = this.button(
      "写入批注",
      () => {
        button.disabled = true;
        button.textContent = "正在写入…";
        void saveAnnotation(translation)
          .then(() => {
            button.textContent = "✓ 已创建高亮批注";
            button.classList.add("lft-button-success");
          })
          .catch((error: unknown) => {
            button.disabled = false;
            button.textContent = "重试写入";
            button.title = `写入批注失败：${errorMessage(error)}`;
          });
      },
      true,
      "对当前选中文本创建高亮，并把本次翻译写入批注内容",
    );
    return button;
  }

  private renderLocalResult(result: LocalLookupResult): void {
    this.queryText = result.word;
    const content = this.element("div");
    for (const entry of result.entries) {
      content.append(this.renderDictionary(entry));
    }
    if (result.errors.length > 0) {
      content.append(
        this.element(
          "div",
          "lft-warning",
          `另有 ${result.errors.length} 个词典问题：${result.errors[0]}`,
        ),
      );
    }
    const annotationButton = this.annotationButton(
      this.localAnnotationText(result),
    );
    this.frame(
      `本地词典 · 命中 ${result.entries.length}/${result.configuredDictionaries}`,
      content,
      [
        ...(annotationButton ? [annotationButton] : []),
        this.button("重新查询", () => void this.lookupLocal()),
        this.button("大模型翻译", () => void this.translateOnline()),
      ],
    );
  }

  private renderLocalMiss(result: LocalLookupResult): void {
    this.queryText = result.word;
    const state = this.element("div", "lft-state");
    const content = this.element("div");
    const noDictionary = result.configuredDictionaries === 0;
    content.append(
      this.element("div", "lft-state-icon", noDictionary ? "⚙" : "∅"),
      this.element(
        "div",
        "lft-state-title",
        noDictionary
          ? "尚未配置可用的本地词典"
          : `本地词典未找到“${result.word}”`,
      ),
      this.element(
        "div",
        "lft-state-detail",
        result.errors[0] ||
          `已查询 ${result.configuredDictionaries} 部词典。可以把时态、复数或派生词修改为原形后重新查询。`,
      ),
    );
    const editor = this.element("div", "lft-word-editor");
    const input = this.element("input", "lft-word-input");
    input.type = "text";
    input.value = result.word;
    input.placeholder = "输入单词原形，例如 traffic";
    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      this.queryText = value;
      void this.lookupLocal();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      submit();
    });
    editor.append(input, this.button("查询此词", submit, true));
    content.append(editor);
    const actions = this.element("div", "lft-state-actions");
    actions.append(
      this.button("词典设置", this.openSettings),
      this.button("使用大模型翻译", () => void this.translateOnline(), true),
    );
    content.append(actions);
    state.append(content);
    this.frame("本地词典 · 未命中", state);
  }

  private renderOnlineResult(text: string, model: string): void {
    const content = this.element("div", "lft-llm-result");
    content.append(this.element("div", "lft-llm-label", "✦ 大模型译文"));
    const lines = this.element("div", "lft-translation-lines");
    for (const line of translationLines(text)) {
      lines.append(this.element("p", "lft-translation-line", line));
    }
    content.append(lines);
    const footer = this.element("div", "lft-footer");
    footer.append(
      this.element("span", "", `OpenAI-compatible · ${model}`),
      this.element("span", "", `${text.length} 字符`),
    );
    content.append(footer);
    const annotationButton = this.annotationButton(text);
    this.frame("大模型翻译 · 分行显示", content, [
      ...(annotationButton ? [annotationButton] : []),
      this.button("复制", () =>
        Zotero.Utilities.Internal.copyTextToClipboard(text),
      ),
      this.button("重新翻译", () => void this.translateOnline()),
      ...(this.isWord
        ? [this.button("本地词典", () => void this.lookupLocal())]
        : []),
    ]);
  }

  private renderOnlineError(message: string): void {
    const state = this.element("div", "lft-state");
    const content = this.element("div");
    content.append(
      this.element("div", "lft-state-icon", "!"),
      this.element("div", "lft-state-title", "大模型翻译失败"),
      this.element("div", "lft-state-detail", message),
    );
    const actions = this.element("div", "lft-state-actions");
    actions.append(
      this.button("接口设置", this.openSettings),
      this.button("重试", () => void this.translateOnline(), true),
    );
    if (this.isWord) {
      actions.prepend(
        this.button("返回本地词典", () => void this.lookupLocal()),
      );
    }
    content.append(actions);
    state.append(content);
    this.frame("OpenAI-compatible API", state);
  }

  async lookupLocal(): Promise<void> {
    const requestID = ++this.requestID;
    this.renderLoading("正在查询本地词典", "本地词典");
    try {
      const result = await this.dictionaries.lookup(this.queryText);
      if (requestID !== this.requestID || !this.root.isConnected) return;
      if (result.entries.length > 0) {
        this.renderLocalResult(result);
      } else {
        this.renderLocalMiss(result);
      }
    } catch (error) {
      if (requestID !== this.requestID || !this.root.isConnected) return;
      this.renderLocalMiss({
        word: this.queryText,
        entries: [],
        errors: [errorMessage(error)],
        configuredDictionaries: 0,
      });
    }
  }

  async translateOnline(): Promise<void> {
    const requestID = ++this.requestID;
    this.renderLoading("正在使用大模型翻译", "OpenAI-compatible API");
    try {
      const result = await translateWithOpenAI(
        this.isWord ? this.queryText : this.text,
      );
      if (requestID !== this.requestID || !this.root.isConnected) return;
      this.renderOnlineResult(result.text, result.model);
    } catch (error) {
      if (requestID !== this.requestID || !this.root.isConnected) return;
      this.renderOnlineError(errorMessage(error));
    }
  }
}
