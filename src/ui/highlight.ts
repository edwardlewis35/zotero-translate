import { isSingleWord, normalizeSelectedWord } from "../selection";

export interface HighlightedPart {
  text: string;
  highlighted: boolean;
}

/** Keep exact lexical matches; a query such as bank must not mark banker. */
export function splitQueryHighlights(
  text: string,
  candidates: string[],
): HighlightedPart[] {
  const words = [...new Set(candidates.map(normalizeSelectedWord))]
    .filter(isSingleWord)
    .sort((a, b) => b.length - a.length);
  if (!words.length) return [{ text, highlighted: false }];
  const escaped = words.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  );
  const pattern = new RegExp(escaped.join("|"), "giu");
  const parts: HighlightedPart[] = [];
  const lexical = /[\p{L}\p{M}\p{N}'’ʼ\u2010\u2011_-]/u;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    const term = match[0];
    // Languages without spaces can put a selected word directly beside Han or
    // kana characters. Latin words still need whole-word boundaries.
    const unspaced =
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(term);
    const before =
      Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) || "";
    const after =
      Array.from(text.slice(index + term.length, index + term.length + 2))[0] ||
      "";
    if (!unspaced && (lexical.test(before) || lexical.test(after))) continue;
    if (index > offset)
      parts.push({ text: text.slice(offset, index), highlighted: false });
    parts.push({ text: term, highlighted: true });
    offset = index + term.length;
  }
  if (offset < text.length)
    parts.push({ text: text.slice(offset), highlighted: false });
  return parts.length ? parts : [{ text, highlighted: false }];
}
