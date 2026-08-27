import type {
  AudioReference,
  DictionarySense,
  Pronunciation,
  WordForm,
} from "./types";
import { parsePlainTextSenses, readableDictionaryLines } from "./plain";

export interface ParsedDefinition {
  pronunciations: Pronunciation[];
  senses: DictionarySense[];
  forms: WordForm[];
  tags: string[];
  audioReferences: AudioReference[];
}

function cleanText(value: string | null | undefined): string {
  return (value || "")
    .replace(/\u00a0/gu, " ")
    .replace(/[\u200b\ufeff]/gu, "")
    .replace(/[\t ]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim();
}

function queryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (node): node is T => node !== null,
  ) as T[];
}

function regionFromClue(value: string): string {
  if (/(?:british|\buk\b|英式|英音|英\s*[：:])/iu.test(value)) return "英";
  if (/(?:american|\bus\b|美式|美音|美\s*[：:])/iu.test(value)) return "美";
  return "音标";
}

function stripPronunciationLabel(value: string): string {
  return cleanText(value)
    .replace(
      /^(?:英式?|英音|美式?|美音|british|american|uk|us|音标)\s*[：:]?\s*/iu,
      "",
    )
    .trim();
}

function looksLikePronunciation(value: string): boolean {
  if (!value || value.length > 90) return false;
  return (
    /[/\[].+[/\]]/u.test(value) ||
    /[əɜɪʊʌɑɒæɛɔθðŋʃʒˈˌ]/u.test(value) ||
    /^(?:英式?|英音|美式?|美音|british|american|uk|us)(?:\b|\s*[：:])/iu.test(
      value,
    )
  );
}

function extractPronunciations(doc: Document): Pronunciation[] {
  const output: Pronunciation[] = [];
  const seen = new Set<string>();
  const selector = [
    ".phon",
    ".phonetic",
    ".pron",
    ".pronounce",
    ".pronunciation",
    ".ipa",
    ".i_phon",
    ".y_phon",
    "[class*='phonetic']",
    "[class*='pronunciation']",
  ].join(",");

  for (const element of queryAll<HTMLElement>(doc, selector)) {
    const raw = cleanText(element.textContent);
    if (!looksLikePronunciation(raw)) continue;
    const text = stripPronunciationLabel(raw);
    if (!text || text.length > 70) continue;
    const clue = [
      raw,
      element.className,
      element.getAttribute("title") || "",
      element.parentElement?.className || "",
    ].join(" ");
    const region = regionFromClue(clue);
    const key = `${region}\u0000${text}`.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ region, text });
    if (output.length >= 4) break;
  }
  return output;
}

function partOfSpeechFromElement(element: Element): string {
  const selector =
    ".pos, .part-of-speech, .partofspeech, .grammar, .gram, [class~='pos']";
  const candidates = [
    ...queryAll<HTMLElement>(element, selector),
    ...(element.parentElement
      ? queryAll<HTMLElement>(element.parentElement, selector)
      : []),
  ];
  for (const candidate of candidates) {
    const value = cleanText(candidate.textContent);
    if (
      value.length <= 28 &&
      /^(?:(?:n|v|vt|vi|adj|adv|prep|pron|conj|interj|aux|num|art|det|modal|abbr|phr)\.?)(?:\s*[/,&]\s*[a-z]+\.?)?$|^(?:名词|动词|形容词|副词|介词|代词|连词|感叹词|数词)/iu.test(
        value,
      )
    ) {
      return value;
    }
  }
  return "";
}

function translationFromElement(element: Element, pos: string): string {
  const translation = element.querySelector<HTMLElement>(
    ".tran, .translation, [class~='trans'], .meaning, [class~='meaning'], .def, [class~='definition']",
  );
  let value = cleanText(translation?.textContent || element.textContent);
  if (pos && value.startsWith(pos)) {
    value = value.slice(pos.length).replace(/^\s*[：:.-]?\s*/u, "");
  }
  return value;
}

function extractStructuredSenses(doc: Document): DictionarySense[] {
  const preferredSelector = [".paraphrase-item", "[class~='sense']", "li"].join(
    ",",
  );
  const genericSelector = [
    "[class~='meaning']",
    "[class~='definition']",
    "[class~='def']",
  ].join(",");
  const preferred = queryAll<Element>(doc, preferredSelector);
  const candidates =
    preferred.length > 0 ? preferred : queryAll<Element>(doc, genericSelector);
  const candidateSet = new Set(candidates);
  const senses: DictionarySense[] = [];
  const seen = new Set<string>();

  for (const element of candidates) {
    if (preferred.length > 0) {
      let parent = element.parentElement;
      let nested = false;
      while (parent) {
        if (candidateSet.has(parent)) {
          nested = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (nested) continue;
    } else if (
      candidates.some(
        (candidate) => candidate !== element && element.contains(candidate),
      )
    ) {
      continue;
    }

    const partOfSpeech = partOfSpeechFromElement(element);
    const translation = translationFromElement(element, partOfSpeech);
    if (!translation || translation.length < 2 || translation.length > 1800) {
      continue;
    }
    const key = `${partOfSpeech}\u0000${translation}`.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const number = cleanText(
      element.querySelector<HTMLElement>(
        ".num, .sense-num, .sense-number, .sn, [class*='sense-number']",
      )?.textContent,
    ).match(/\d{1,2}/u)?.[0];
    senses.push({
      partOfSpeech,
      translation,
      number,
      lines: readableDictionaryLines(translation),
    });
    if (senses.length >= 18) break;
  }
  return senses;
}

export function definitionToPlainText(definition: string): string {
  const doc = new DOMParser().parseFromString(definition, "text/html");
  doc
    .querySelectorAll("script, style, noscript, template, svg")
    .forEach((node) => node.remove());
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc
    .querySelectorAll("hr")
    .forEach((node) => node.replaceWith("\n──────────\n"));
  doc.querySelectorAll("li").forEach((node) => node.prepend("• "));
  doc.querySelectorAll("td, th").forEach((node) => node.append("  "));
  doc
    .querySelectorAll(
      "p, div, li, tr, h1, h2, h3, h4, h5, h6, dt, dd, blockquote, section, article",
    )
    .forEach((node) => {
      node.before("\n");
      node.after("\n");
    });

  return cleanText(doc.body?.textContent || doc.documentElement.textContent)
    .replace(/[\t ]+\n/gu, "\n")
    .replace(/\n[\t ]+/gu, "\n")
    .replace(/\n{2,}/gu, "\n");
}

function fallbackSenses(definition: string): DictionarySense[] {
  const plain = definitionToPlainText(definition);
  return parsePlainTextSenses(plain);
}

function extractForms(plain: string): WordForm[] {
  const rules: Array<[string, RegExp]> = [
    [
      "复数",
      /(?:复数|plural(?: form)?)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
    [
      "第三人称单数",
      /(?:第三人称单数|third[- ]person singular)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
    [
      "现在分词",
      /(?:现在分词|present participle)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
    ["过去式", /(?:过去式|past tense)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu],
    [
      "过去分词",
      /(?:过去分词|past participle)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
    [
      "比较级",
      /(?:比较级|comparative)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
    [
      "最高级",
      /(?:最高级|superlative)\s*[：:]?\s*([\p{L}][\p{L}\p{M}'’.-]*)/iu,
    ],
  ];
  return rules.flatMap(([label, pattern]) => {
    const value = plain.match(pattern)?.[1];
    return value ? [{ label, value }] : [];
  });
}

function extractTags(plain: string): string[] {
  const matches = plain.match(
    /\b(?:CET4|CET6|TEM4|TEM8|TOEFL|IELTS|GRE|SAT)\b|初中|高中|考研/giu,
  );
  return [...new Set(matches || [])].slice(0, 10);
}

export function extractAudioReferences(definition: string): AudioReference[] {
  const doc = new DOMParser().parseFromString(definition, "text/html");
  const output: AudioReference[] = [];
  const seen = new Set<string>();
  for (const element of queryAll<HTMLElement>(doc, "[href], [src]")) {
    const value = element.getAttribute("href") || element.getAttribute("src");
    if (!value?.toLocaleLowerCase().startsWith("sound://")) continue;
    let resource = value.slice("sound://".length);
    try {
      resource = decodeURIComponent(resource);
    } catch {
      // Some dictionaries use malformed percent escapes but valid MDD keys.
    }
    resource = resource.replace(/^[/\\]+/u, "");
    if (!resource) continue;
    const key = resource.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const clue = [
      cleanText(element.textContent),
      element.className,
      element.getAttribute("title") || "",
      resource,
    ].join(" ");
    output.push({
      resource,
      region: regionFromClue(clue),
      label:
        cleanText(element.textContent) ||
        resource.split(/[/\\]/u).pop() ||
        "发音",
    });
    if (output.length >= 6) break;
  }
  return output;
}

export function parseDefinition(
  definition: string,
  headword: string,
): ParsedDefinition {
  const doc = new DOMParser().parseFromString(definition, "text/html");
  doc
    .querySelectorAll("script, style, noscript, template")
    .forEach((node) => node.remove());
  const plain = definitionToPlainText(definition);
  const audioReferences = extractAudioReferences(definition);
  const pronunciations = extractPronunciations(doc);
  if (pronunciations.length === 0 && audioReferences.length > 0) {
    for (const audio of audioReferences.slice(0, 2)) {
      pronunciations.push({ region: audio.region, text: headword });
    }
  }
  const structured = extractStructuredSenses(doc);
  const fallback = fallbackSenses(definition);
  const structuredIsFlattened =
    structured.length <= 1 &&
    (structured[0]?.translation.length || 0) > 360 &&
    fallback.length > structured.length;
  return {
    pronunciations,
    senses:
      structured.length > 0 && !structuredIsFlattened ? structured : fallback,
    forms: extractForms(plain),
    tags: extractTags(plain),
    audioReferences,
  };
}
