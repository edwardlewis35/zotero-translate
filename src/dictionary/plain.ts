import type {
  DictionaryLineKind,
  DictionarySense,
  DictionarySenseLine,
} from "./types";

const POS_PATTERN =
  "noun|verb|adjective|adverb|preposition|pronoun|conjunction|interjection|determiner|auxiliary|modal|numeral|n|v|vt|vi|adj|adv|prep|pron|conj|interj|det|aux|num|phr";

const POS_NAMES: Record<string, string> = {
  noun: "n.",
  n: "n.",
  verb: "v.",
  v: "v.",
  vt: "vt.",
  vi: "vi.",
  adjective: "adj.",
  adj: "adj.",
  adverb: "adv.",
  adv: "adv.",
  preposition: "prep.",
  prep: "prep.",
  pronoun: "pron.",
  pron: "pron.",
  conjunction: "conj.",
  conj: "conj.",
  interjection: "interj.",
  interj: "interj.",
  determiner: "det.",
  det: "det.",
  auxiliary: "aux.",
  aux: "aux.",
  modal: "modal",
  numeral: "num.",
  num: "num.",
  phr: "phr.",
};

function clean(value: string): string {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/[\u200b\ufeff]/gu, "")
    .replace(/[\t ]+/gu, " ")
    .trim();
}

function lineKind(text: string): DictionaryLineKind {
  const han = text.match(/\p{Script=Han}/gu)?.length || 0;
  const latin = text.match(/[A-Za-z]/gu)?.length || 0;
  if (han > 0 && latin > 0) return "mixed";
  if (han > 0) return "translation";
  if (
    latin > 0 &&
    (/^[A-Z]/u.test(text) || /[.!?][”'\)]?$/u.test(text) || text.length > 58)
  ) {
    return "example";
  }
  return "definition";
}

function splitLongLine(line: string): string[] {
  if (line.length <= 320) return [line];
  const sentences =
    line
      .match(/[^。！？!?；;]+[。！？!?；;]?/gu)
      ?.map(clean)
      .filter(Boolean) || [];
  if (sentences.length > 1) return sentences;

  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 320) {
    let end = rest.lastIndexOf(" ", 300);
    if (end < 160) end = 300;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Split flattened MDict text at semantic and language boundaries. */
export function readableDictionaryLines(value: string): DictionarySenseLine[] {
  const expanded = clean(value)
    .replace(/([。！？；])\s*/gu, "$1\n")
    .replace(/([a-z0-9”'\)])\.\s+(?=[A-Z\p{Script=Han}])/gu, "$1.\n")
    .replace(/([!?])\s+(?=[A-Z\p{Script=Han}])/gu, "$1\n")
    .replace(/([A-Za-z0-9!?.,)'”\]])\s+(?=[（(]?\p{Script=Han})/gu, "$1\n")
    .replace(/([\p{Script=Han}。！？，；）】])\s+(?=[A-Za-z~])/gu, "$1\n");

  const seen = new Set<string>();
  const lines: DictionarySenseLine[] = [];
  for (const raw of expanded.split(/\n+/u)) {
    for (const text of splitLongLine(clean(raw))) {
      if (!text || /^[-—_=·•]{4,}$/u.test(text)) continue;
      const key = text.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ text, kind: lineKind(text) });
    }
  }
  return lines;
}

function normalizePartOfSpeech(value: string): string {
  return POS_NAMES[value.replace(/\.$/u, "").toLocaleLowerCase()] || value;
}

function extractPartOfSpeech(value: string): {
  partOfSpeech: string;
  text: string;
} {
  const direct = value.match(
    new RegExp(`^(${POS_PATTERN})\\.?\\s*[：:.]?\\s*(.*)$`, "iu"),
  );
  if (direct) {
    return {
      partOfSpeech: normalizePartOfSpeech(direct[1] || ""),
      text: clean(direct[2] || ""),
    };
  }

  const headword = value.match(
    new RegExp(
      `^[\\p{L}\\p{M}∙·'’.-]+\\s+(?:/[^/\\n]{1,90}/\\s+)?(${POS_PATTERN})\\.?\\s*(.*)$`,
      "iu",
    ),
  );
  if (headword) {
    return {
      partOfSpeech: normalizePartOfSpeech(headword[1] || ""),
      text: clean(headword[2] || ""),
    };
  }
  return { partOfSpeech: "", text: value };
}

function addSense(
  output: DictionarySense[],
  number: string | undefined,
  partOfSpeech: string,
  lines: DictionarySenseLine[],
): void {
  if (lines.length === 0) return;
  output.push({
    number,
    partOfSpeech,
    lines,
    translation: lines.map((line) => line.text).join("\n"),
  });
}

/**
 * Convert a flattened dictionary entry into display-ready senses. Numbered
 * senses and later headword/POS sections become separate cards.
 */
export function parsePlainTextSenses(value: string): DictionarySense[] {
  const withBoundaries = clean(value)
    .replace(
      /\s+(?=((?:[1-9]|1\d))\s+(?=(?:the|a|an|to|used|[A-Za-z~])))/giu,
      "\n",
    )
    .replace(
      new RegExp(
        `\\s+(?=[\\p{L}\\p{M}∙·'’.-]{2,48}\\s+/[^/\\n]{1,90}/\\s+(?:${POS_PATTERN})\\b)`,
        "giu",
      ),
      "\n",
    );

  const output: DictionarySense[] = [];
  let number: string | undefined;
  let partOfSpeech = "";
  let lines: DictionarySenseLine[] = [];

  const flush = () => {
    addSense(output, number, partOfSpeech, lines);
    number = undefined;
    partOfSpeech = "";
    lines = [];
  };

  for (const rawLine of withBoundaries.split(/\n+/u)) {
    let text = clean(rawLine);
    if (!text) continue;

    const numbered = text.match(/^((?:[1-9]|1\d))[.)]?\s+(.+)$/u);
    if (numbered) {
      flush();
      number = numbered[1];
      text = numbered[2] || "";
    }

    const pos = extractPartOfSpeech(text);
    if (pos.partOfSpeech) {
      if (lines.length > 0) flush();
      partOfSpeech = pos.partOfSpeech;
      text = pos.text;
    }
    if (text) lines.push(...readableDictionaryLines(text));
  }
  flush();

  if (output.length > 1 && output[0] && !output[0].number) {
    output[0].number = "1";
  }
  return output.slice(0, 24);
}
