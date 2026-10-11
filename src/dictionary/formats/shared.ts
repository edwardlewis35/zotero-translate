import type { DictionarySense, DictionarySenseLine } from "../types";

export function text(value: string | null | undefined): string {
  return (value || "")
    .replace(/[\u0000\u200b\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function style(element: Element, property: string): string {
  return (
    element
      .getAttribute("style")
      ?.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "iu"))?.[1]
      ?.trim()
      .toLocaleLowerCase() || ""
  );
}

export function isBlock(element: Element): boolean {
  return style(element, "display") === "block";
}

// Zotero's DOM declarations allow nullable collection items. Keep that detail
// at this boundary so format adapters can work with actual elements and nodes.
export function elements(root: ParentNode, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (node): node is HTMLElement => node !== null,
  ) as HTMLElement[];
}

export function nodes(root: Node): Node[] {
  return Array.from(root.childNodes).filter(
    (node): node is Node => node !== null,
  ) as Node[];
}

export function withoutBlocks(element: Element): HTMLElement {
  const copy = element.cloneNode(true) as HTMLElement;
  elements(copy, "span")
    .filter(isBlock)
    .forEach((node) => node.remove());
  return copy;
}

export function bilingual(element: Element): {
  chinese: string;
  definition: string;
} {
  const copy = element.cloneNode(true) as HTMLElement;
  const selected: Element[] = [];
  for (const node of elements(copy, "span, p")) {
    const value = text(node.textContent);
    const han = value.match(/\p{Script=Han}/gu)?.length || 0;
    const latin = value.match(/[A-Za-z]/gu)?.length || 0;
    const ownText = nodes(node)
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent)
      .join(" ");
    // Select the Chinese fragment rather than its English definition wrapper.
    // Chinese sentences may still contain highlighted English words.
    if (!/\p{Script=Han}/u.test(ownText) || !han) continue;
    if (
      !/^[\s\p{P}\p{S}]*\p{Script=Han}/u.test(value) &&
      latin > Math.max(8, han / 2)
    )
      continue;
    if (selected.some((parent) => parent.contains(node))) continue;
    selected.push(node);
  }
  const chinese = selected
    .map((node) => text(node.textContent))
    .filter(Boolean)
    .join("\n");
  selected.forEach((node) => node.remove());
  let definition = text(copy.textContent);
  if (!chinese && /\p{Script=Han}/u.test(definition)) {
    const index = definition.search(/\p{Script=Han}/u);
    let boundary = index;
    if (/[（(]$/u.test(definition.slice(0, index).trimEnd())) {
      boundary = definition.slice(0, index).trimEnd().length - 1;
    }
    // A usage translation can begin with an English lemma directly attached
    // to Chinese, e.g. "English sentence. lumen的…". Keep that lemma with its
    // translation when an actual sentence boundary makes the split clear.
    const prefix = definition.slice(0, index);
    const lemma = prefix.match(/[A-Za-z][A-Za-z'’-]*$/u);
    if (
      lemma &&
      lemma.index !== undefined &&
      /(?:^|[.!?;:]\s*)$/u.test(prefix.slice(0, lemma.index))
    ) {
      boundary = lemma.index;
    }
    return {
      chinese: definition.slice(boundary).trim(),
      definition: definition.slice(0, boundary).trim(),
    };
  }
  definition = definition.replace(/\s+([,.;!?])/gu, "$1");
  return { chinese, definition };
}

export function partOfSpeech(value: string): string {
  const names: Record<string, string> = {
    noun: "n.",
    verb: "v.",
    adjective: "adj.",
    adverb: "adv.",
    exclamation: "interj.",
    interjection: "interj.",
    preposition: "prep.",
    pronoun: "pron.",
    conjunction: "conj.",
    determiner: "det.",
    convention: "惯用语",
    phrase: "phr.",
    quant: "数量词",
    num: "num.",
  };
  return text(value)
    .split(/\s*[,/]\s*/u)
    .map((part) => {
      const token = part.split(/\s/u)[0]?.toLocaleLowerCase() || "";
      if (/^n-/u.test(token)) return "n.";
      if (/^v-/u.test(token)) return "v.";
      if (/^adj(?:-|$)/u.test(token)) return "adj.";
      if (/^adv(?:-|$)/u.test(token)) return "adv.";
      return (
        names[token] ||
        (/^(?:n|v|vt|vi|adj|adv|prep|pron|conj|interj|det|phr)\.?$/u.test(token)
          ? token.replace(/\.?$/u, ".")
          : part)
      );
    })
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(" / ");
}

export function finishSense(sense: DictionarySense): DictionarySense {
  const lines: DictionarySenseLine[] = [];
  if (sense.heading) lines.push({ text: sense.heading, kind: "definition" });
  if (sense.labels?.length)
    lines.push({ text: sense.labels.join(" · "), kind: "mixed" });
  if (sense.chinese) lines.push({ text: sense.chinese, kind: "translation" });
  if (sense.definition)
    lines.push({ text: sense.definition, kind: "definition" });
  for (const example of sense.examples || []) {
    if (example.text) lines.push({ text: example.text, kind: "example" });
    if (example.translation)
      lines.push({ text: example.translation, kind: "translation" });
  }
  for (const note of sense.notes || []) {
    if (note.text) lines.push({ text: note.text, kind: "mixed" });
    if (note.translation)
      lines.push({ text: note.translation, kind: "translation" });
  }
  sense.lines = lines;
  sense.translation = lines.map((line) => line.text).join("\n");
  return sense;
}
