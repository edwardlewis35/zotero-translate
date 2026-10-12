import { isSingleWord, normalizeSelectedWord } from "./selection";

export type SelectionMode = "word" | "translation";

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

function renderPrompt(
  template: string,
  sourceText: string,
  targetLanguage: string,
): string {
  const hasSourcePlaceholder = template.includes("${sourceText}");
  const rendered = template
    .split("${sourceText}")
    .join(sourceText)
    .split("${targetLanguage}")
    .join(targetLanguage);
  return hasSourcePlaceholder
    ? rendered
    : `${rendered.trim()}\n\n待翻译内容：\n${sourceText}`;
}

export function buildTranslationMessages(
  sourceText: string,
  prompt: string,
  targetLanguage: string,
  mode: SelectionMode = isSingleWord(sourceText) ? "word" : "translation",
): PromptMessage[] {
  if (mode === "translation") {
    return [
      {
        role: "user",
        content: renderPrompt(prompt, sourceText, targetLanguage),
      },
    ];
  }

  const word = normalizeSelectedWord(sourceText);
  return [
    {
      role: "system",
      content:
        `你是一名严谨的双语词典编纂助手。本次选中内容是单个单词或词形，请用 ${targetLanguage} 编写完整、实用的词典条目，而不是只给一个译词或一句简短释义。\n` +
        "请按下面的结构组织，使用简洁的 Markdown 标题、编号、列表和粗体；不要输出 HTML 或 JSON：\n" +
        "1. 词条与发音：给出查询词、对应原形（如适用）和可靠的音标；不确定的音标不要编造。\n" +
        "2. 词性与主要释义：按词性分组，列出各主要常见义项，给出准确的释义和必要的使用场景；遇到多义词要覆盖主要含义，不要只列第一个义项。\n" +
        `3. 双语例句：每个主要义项至少提供一条自然的原语言例句，并在下一行给出 ${targetLanguage} 译文；整个条目至少两条例句。例句由你编写，不要假称来自某部词典。\n` +
        "4. 用法与搭配：列出常见搭配、短语、语法限制和适用语域；没有可靠内容时可以省略相应小项。\n" +
        "5. 词形与辨析：按需要说明复数、时态、比较级、派生词或易混词区别，不要为不可变词编造词形。\n" +
        "保持信息充分且易读，不重复凑字，不宣称穷尽所有罕见义项。用户自定义提示词中的目标语言、术语和风格偏好仍然适用；其中仅翻译、简明释义或只输出一个解释等限制应让位于本次完整词典条目的要求。",
    },
    {
      role: "user",
      content: renderPrompt(prompt, word, targetLanguage),
    },
  ];
}
