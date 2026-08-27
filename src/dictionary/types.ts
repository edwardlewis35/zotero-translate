export interface Pronunciation {
  region: string;
  text: string;
}

export type DictionaryLineKind =
  "definition" | "example" | "translation" | "mixed";

export interface DictionarySenseLine {
  text: string;
  kind: DictionaryLineKind;
}

export interface DictionarySense {
  partOfSpeech: string;
  translation: string;
  number?: string;
  lines: DictionarySenseLine[];
}

export interface WordForm {
  label: string;
  value: string;
}

export interface AudioAsset {
  label: string;
  region: string;
  url: string;
}

export interface AudioReference {
  label: string;
  region: string;
  resource: string;
}

export interface DictionaryEntry {
  source: string;
  headword: string;
  pronunciations: Pronunciation[];
  senses: DictionarySense[];
  forms: WordForm[];
  tags: string[];
  audio: AudioAsset[];
}

export interface LocalLookupResult {
  word: string;
  entries: DictionaryEntry[];
  errors: string[];
  configuredDictionaries: number;
}
