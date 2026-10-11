export interface Pronunciation {
  region: string;
  text: string;
  resource?: string;
}

export type DictionaryLineKind =
  "definition" | "example" | "translation" | "mixed";

export interface DictionarySenseLine {
  text: string;
  kind: DictionaryLineKind;
}

export interface DictionaryExample {
  text: string;
  translation?: string;
}

export interface DictionarySense {
  partOfSpeech: string;
  translation: string;
  number?: string;
  lines: DictionarySenseLine[];
  chinese?: string;
  definition?: string;
  examples?: DictionaryExample[];
  notes?: DictionaryExample[];
  labels?: string[];
  heading?: string;
}

export interface StructuredDictionaryDefinition {
  senses: DictionarySense[];
  pronunciations?: Pronunciation[];
  forms?: WordForm[];
  tags?: string[];
}

export interface WordForm {
  label: string;
  value: string;
}

export interface AudioAsset {
  label: string;
  region: string;
  resource?: string;
  url?: string;
  load?: () => Promise<string>;
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

export interface LocalLookupProgress {
  result: LocalLookupResult;
  completed: number;
  total: number;
  message: string;
}

export interface LocalLookupOptions {
  onProgress?: (progress: LocalLookupProgress) => void;
  isCancelled?: () => boolean;
}
