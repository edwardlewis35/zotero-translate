import type {
  DictionaryExample,
  DictionarySense,
  Pronunciation,
  StructuredDictionaryDefinition,
  WordForm,
} from "../types";
import {
  bilingual,
  elements,
  nodes,
  finishSense,
  isBlock,
  partOfSpeech,
  style,
  text,
  withoutBlocks,
} from "./shared";

const isBold = (node: Element) =>
  /^(?:bold|[7-9]00)$/u.test(style(node, "font-weight"));
const isItalic = (node: Element) => style(node, "font-style") === "italic";
const isBlue = (node: Element) => style(node, "color") === "#3333cc";
const lemma = (value: string) =>
  text(value)
    .replace(/[∙·\s]/gu, "")
    .toLocaleLowerCase();

function pronunciations(doc: Document): Pronunciation[] {
  const output: Pronunciation[] = [];
  for (const audio of elements(doc, "a[href^='sound://']")) {
    const phon = audio.parentElement;
    if (!phon) continue;
    const value = text(phon.textContent).replace(/^[/;\s]+|[/;\s]+$/gu, "");
    if (!value || value.length > 90 || /\p{Script=Han}/u.test(value)) continue;
    const wrapper = phon.parentElement;
    if (!wrapper || !/^\s*\//u.test(wrapper.textContent || "")) continue;
    let region = /\bNAmE\b|\bBrE\b/u.test(text(wrapper.textContent))
      ? "英"
      : "音标";
    for (const sibling of Array.from(wrapper.children)) {
      if (sibling === phon) break;
      if (/\bNAmE\b|\bAmE\b/u.test(text(sibling.textContent))) region = "美";
      if (/\bBrE\b/u.test(text(sibling.textContent))) region = "英";
    }
    // Inflection audio belongs to the green form immediately before its
    // phonetic wrapper, rather than to a second pronunciation of the lemma.
    const form = wrapper.previousElementSibling;
    if (form && style(form, "color") === "#33cc33")
      region = text(form.textContent);
    let resource = (audio.getAttribute("href") || "")
      .slice("sound://".length)
      .replace(/^[/\\]+/u, "");
    try {
      resource = decodeURIComponent(resource);
    } catch {
      /* Keep the original MDD key. */
    }
    const item = { region, text: `/${value}/`, resource };
    if (
      !output.some(
        (existing) => existing.region === region && existing.text === item.text,
      )
    )
      output.push(item);
  }
  return output;
}

function removeHeaderDetails(root: HTMLElement): void {
  for (const audio of elements(root, "a[href^='sound://']")) {
    let node = audio.parentElement;
    while (
      node?.parentElement &&
      node.parentElement !== root &&
      (node.parentElement.textContent || "").length < 180
    ) {
      node = node.parentElement;
      if (/^\s*\//u.test(node.textContent || "")) break;
    }
    node?.remove();
  }
  for (const node of elements(root, "span")) {
    if (style(node, "color") === "#33cc33") node.remove();
  }
  root.querySelectorAll("img").forEach((node) => node.remove());
}

export function parseOxfordDefinition(
  doc: Document,
  headword: string,
): StructuredDictionaryDefinition | null {
  const spans = elements(doc, "span");
  const firstHeadword = spans.find((node) => isBlue(node) && isBold(node));
  const posNodes = spans.filter(
    (node) => isBlock(node) && isBold(node) && isItalic(node),
  );
  if (
    !firstHeadword ||
    lemma(firstHeadword.textContent || "") !== lemma(headword) ||
    !posNodes.length
  )
    return null;
  const senses: DictionarySense[] = [];
  const forms: WordForm[] = [];
  for (const node of spans.filter(
    (node) =>
      style(node, "color") === "#33cc33" ||
      (isBlue(node) &&
        (node.parentElement?.textContent || "").length < 200 &&
        /\bpl\./iu.test(node.parentElement?.textContent || "")),
  )) {
    const value = text(node.textContent);
    if (!value) continue;
    const label = /\bpl\./iu.test(node.parentElement?.textContent || "")
      ? "复数"
      : "词形";
    if (!forms.some((item) => item.value === value && item.label === label))
      forms.push({ label, value });
  }
  let currentPOS = "";
  let topic = "";
  let phrase = "";
  let active: DictionarySense | undefined;
  let pending = doc.createElement("span");

  const create = (
    node: Element,
    number?: string,
    heading?: string,
  ): DictionarySense | undefined => {
    const copy = withoutBlocks(node);
    const notes: DictionaryExample[] = [];
    for (const image of elements(copy, "img[src$='help.gif']")) {
      const note = image.parentElement;
      if (!note || note === copy) continue;
      image.remove();
      const value = bilingual(note);
      if (value.definition || value.chinese)
        notes.push({
          text: value.definition,
          translation: value.chinese || undefined,
        });
      note.remove();
    }
    if (number) {
      const first = nodes(copy).find(
        (child) => child.nodeType === 3 && /\d/u.test(child.textContent || ""),
      );
      if (first)
        first.textContent = (first.textContent || "").replace(
          /^\s*\d+[.)]?\s*/u,
          "",
        );
    }
    const value = bilingual(copy);
    const labels =
      value.definition.match(/\[(?:[A-Z][A-Za-z ,/\-]{0,25})\]/gu) || [];
    value.definition = value.definition
      .replace(/\[(?:[A-Z][A-Za-z ,/\-]{0,25})\]/gu, "")
      .trim();
    if (
      !value.chinese &&
      (!value.definition || !/[A-Za-z]{3}/u.test(value.definition))
    )
      return undefined;
    const sense: DictionarySense = {
      number,
      partOfSpeech: heading === phrase && phrase ? "phr." : currentPOS,
      chinese: value.chinese,
      definition: value.definition,
      heading: heading || undefined,
      labels: [...new Set(labels)],
      examples: [],
      notes,
      lines: [],
      translation: "",
    };
    senses.push(sense);
    return sense;
  };
  const flushPending = () => {
    removeHeaderDetails(pending);
    // Unnumbered bilingual definitions (e.g. separate noun/verb sections)
    // are real senses; bare pronunciation/forms/grammar headers are not.
    if (/\p{Script=Han}/u.test(pending.textContent || ""))
      active = create(pending, undefined, topic);
    pending = doc.createElement("span");
  };
  const trailing = (element: Element) => {
    if (!active) return;
    const value = bilingual(element);
    if (!value.chinese && !/[A-Za-z]{2}/u.test(value.definition)) return;
    if (/^\[[A-Z][A-Za-z ,/\-]{0,25}\]$/u.test(value.definition)) {
      if (!active.labels?.includes(value.definition))
        active.labels?.push(value.definition);
    } else if (
      !active.notes?.some(
        (note) =>
          note.text === value.definition &&
          note.translation === (value.chinese || undefined),
      )
    ) {
      active.notes?.push({
        text: value.definition,
        translation: value.chinese || undefined,
      });
    }
  };
  const walk = (node: Node, inlineCaptured = false): void => {
    if (node.nodeType !== 1) {
      if (!active && currentPOS) pending.append(node.cloneNode(true));
      return;
    }
    const element = node as HTMLElement;
    if (isBlock(element)) {
      if (isBold(element) && isItalic(element)) {
        flushPending();
        currentPOS = partOfSpeech(text(element.textContent));
        active = undefined;
        topic = "";
        phrase = "";
        return;
      }
      if (
        isBold(element) &&
        !isItalic(element) &&
        style(element, "color") === "#cc3333"
      ) {
        flushPending();
        const title = bilingual(withoutBlocks(element));
        topic = title.chinese || title.definition;
        active = undefined;
        phrase = "";
        return;
      }
      const direct = text(
        nodes(element)
          .filter((child) => child.nodeType === 3)
          .map((child) => child.textContent)
          .join(" "),
      );
      const number =
        isBold(element) && !isItalic(element)
          ? direct.match(/^(\d{1,3})\b/u)?.[1]
          : undefined;
      if (number) {
        flushPending();
        active = create(element, number, phrase || topic);
        Array.from(element.children).forEach((child) => walk(child, true));
        return;
      }
      if (!isBold(element) && isItalic(element)) {
        if (!active) flushPending();
        const value = bilingual(withoutBlocks(element));
        if (active && (value.definition || value.chinese))
          active.examples?.push({
            text: value.definition,
            translation: value.chinese || undefined,
          });
        return;
      }
      const copy = withoutBlocks(element);
      const blue = elements(copy, "span").find(isBlue);
      if (blue) {
        flushPending();
        const title = text(blue.textContent);
        blue.remove();
        const remaining = text(copy.textContent);
        if (/^(?:noun|verb|adj\.?|adv\.?)$/iu.test(remaining)) {
          if (!forms.some((form) => form.value === title))
            forms.push({ label: "派生词", value: title });
          return;
        }
        phrase = title;
        topic = "";
        active = create(copy, undefined, phrase);
        Array.from(element.children)
          .filter((child) => child !== blue)
          .forEach((child) => walk(child, true));
        return;
      }
    }
    // Preserve the original inline structure until the first example so
    // embedded Chinese spans can be separated without language guessing.
    if (!active && currentPOS && !elements(element, "span").some(isBlock)) {
      pending.append(element.cloneNode(true));
      return;
    }
    if (active && !elements(element, "span").some(isBlock)) {
      if (!inlineCaptured) trailing(element);
      return;
    }
    nodes(element).forEach((child) => walk(child, inlineCaptured));
  };
  nodes(doc.body).forEach((child) => walk(child));
  flushPending();
  return senses.length
    ? {
        senses: senses.map(finishSense),
        pronunciations: pronunciations(doc),
        forms,
      }
    : null;
}
