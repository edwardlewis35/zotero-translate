import type {
  DictionaryExample,
  DictionarySense,
  StructuredDictionaryDefinition,
} from "../types";
import { bilingual, elements, finishSense, partOfSpeech, text } from "./shared";

function examples(root: Element): DictionaryExample[] {
  const output: DictionaryExample[] = [];
  for (const item of elements(root, "li")) {
    const paragraphs = Array.from(item.children).filter(
      (child) => child.tagName.toLocaleLowerCase() === "p",
    );
    if (!paragraphs.length) continue;
    let pending: DictionaryExample | undefined;
    for (const paragraph of paragraphs) {
      const value = text(paragraph.textContent);
      if (!value) continue;
      if (/\p{Script=Han}/u.test(value) && pending) {
        pending.translation = [pending.translation, value]
          .filter(Boolean)
          .join("\n");
      } else {
        pending = { text: value };
        output.push(pending);
      }
    }
  }
  return output;
}

function sourceGroupHeading(doc: Document, block: Element): string {
  const group = block
    .closest("[id^='menu_']")
    ?.getAttribute("id")
    ?.match(/^menu_(\d+)$/u)?.[1];
  if (!group) return "";
  const item = elements(doc, ".part_list li")[Number(group) - 1];
  if (!item) return "";
  const title = item.cloneNode(true) as HTMLElement;
  title.textContent = text(title.textContent).replace(/^\d+[.)]?\s*/u, "");
  const value = bilingual(title);
  return value.chinese || value.definition;
}

function usageText(root: Element): { chinese: string; definition: string } {
  const paragraphs = elements(root, "p")
    .map((node) => text(node.textContent))
    .filter(Boolean);
  const translations = paragraphs.filter((value) =>
    /\p{Script=Han}/u.test(value),
  );
  const definitions = paragraphs.filter(
    (value) => !/\p{Script=Han}/u.test(value),
  );
  if (translations.length && definitions.length) {
    // Paired usage paragraphs have explicit language boundaries. A Chinese
    // paragraph may begin with "word 和 another" or contain English examples;
    // preserve it whole instead of moving those words into the English note.
    return {
      chinese: translations.join("\n"),
      definition: definitions.join("\n"),
    };
  }
  return bilingual(root);
}

export function parseCollinsDefinition(
  doc: Document,
  _headword: string,
): StructuredDictionaryDefinition | null {
  if (!doc.querySelector(".collins_content .collins_en_cn")) return null;
  const senses: DictionarySense[] = [];
  for (const block of elements(
    doc,
    ".collins_en_cn, .vExplain_r, .vExplain_s, .vEn_tip",
  )) {
    // Nested supplementary blocks are processed with their containing sense.
    if (block.parentElement?.closest(".collins_en_cn")) continue;
    const caption = block.querySelector(".caption");
    const copy = (caption || block).cloneNode(true) as HTMLElement;
    const number = text(caption?.querySelector(".num")?.textContent).match(
      /\d+/u,
    )?.[0];
    const pos = text(caption?.querySelector(".st")?.textContent);
    const chineseNode =
      caption &&
      Array.from(caption.children).find((child) =>
        child.classList.contains("text_blue"),
      );
    let chinese = text(chineseNode?.textContent);
    const labels = (caption ? elements(caption, "[id^='word_gram_'] div") : [])
      .filter((node) => !node.querySelector("div"))
      .map((node) => text(node.textContent))
      .filter(Boolean);
    const chinesePOS = pos.match(/\p{Script=Han}.*$/u)?.[0];
    if (
      chinesePOS &&
      !["名词", "动词", "形容词", "副词", "短语", "惯用语"].includes(chinesePOS)
    )
      labels.unshift(chinesePOS);
    copy
      .querySelectorAll(".num, .st, [id^='word_gram_'], ul, .en_tip")
      .forEach((node) => node.remove());
    const mainChinese = Array.from(copy.children).find((child) =>
      child.classList.contains("text_blue"),
    );
    mainChinese?.remove();
    let definition = text(copy.textContent);
    let heading = sourceGroupHeading(doc, block);
    if (block.classList.contains("vExplain_r")) {
      heading = text(block.querySelector("b")?.textContent);
      definition = definition.replace(heading, "").trim();
    } else if (
      block.classList.contains("vExplain_s") ||
      block.classList.contains("vEn_tip")
    ) {
      heading = "用法说明";
      // Exports use both paired paragraphs and one mixed text node for notes.
      // Preserve Chinese explanations with embedded English vocabulary.
      const note = usageText(copy);
      chinese = note.chinese;
      definition = note.definition;
    } else if (!caption) {
      heading = "用法说明";
      const note = usageText(copy);
      chinese = note.chinese;
      definition = note.definition;
    }
    if (/相关词组/u.test(definition)) heading = "相关短语";
    if (definition.startsWith("See also:")) heading = "参见";
    const sense: DictionarySense = {
      number,
      partOfSpeech: partOfSpeech(pos),
      chinese,
      definition,
      heading: heading || undefined,
      labels: [...new Set(labels)],
      examples: examples(block),
      lines: [],
      translation: "",
    };
    if (chinese || definition || sense.examples?.length) senses.push(sense);
    for (const tip of elements(block, ".en_tip, .vEn_tip")) {
      const tipCopy = tip.cloneNode(true) as HTMLElement;
      tipCopy.querySelectorAll("ul").forEach((node) => node.remove());
      const detail = usageText(tipCopy);
      if (!detail.definition && !detail.chinese) continue;
      // The parent keeps only direct examples; supplementary examples belong
      // with the additional sense so they are never repeated in the UI.
      const supplementary = examples(tip);
      if (supplementary.length && sense.examples) {
        sense.examples = sense.examples.filter(
          (item) =>
            !supplementary.some(
              (other) =>
                other.text === item.text &&
                other.translation === item.translation,
            ),
        );
      }
      senses.push({
        partOfSpeech: /also a noun/iu.test(detail.definition)
          ? "n."
          : sense.partOfSpeech,
        heading: tip.classList.contains("vEn_tip") ? "用法说明" : "补充用法",
        definition: detail.definition,
        chinese: detail.chinese,
        examples: supplementary,
        lines: [],
        translation: "",
      });
    }
  }
  const stars = text(
    doc.querySelector("font[color='gold']")?.textContent,
  ).match(/★/gu)?.length;
  return senses.length
    ? {
        senses: senses.map(finishSense),
        forms: [],
        tags: stars ? [`${stars} 星词汇`] : [],
      }
    : null;
}
