import { config } from "./config";
import {
  groupDictionaryPaths,
  parseDictionaryPaths,
  pathParts,
} from "./dictionary/paths";

export interface DictionaryConfig {
  id: string;
  name: string;
  mdxPath: string;
  mddPaths: string[];
  enabled: boolean;
}

export interface APIProfile {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: string;
  targetLanguage: string;
  prompt: string;
}

export interface PluginSettings {
  autoTranslateWord: boolean;
  autoTranslateParagraph: boolean;
  loadDictionaryAudio: boolean;
  dictionaryPaths: string;
  dictionaryConfigs: string;
  apiProfiles: string;
  selectedApiProfileId: string;
  // Retained for automatic migration from versions before 0.3.0.
  openaiEndpoint: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiTemperature: string;
  targetLanguage: string;
  openaiPrompt: string;
}

export type PrefKey = keyof PluginSettings;

export const DEFAULT_PROMPT =
  "你是一名严谨的专业翻译助手。请将下面内容翻译为 ${targetLanguage}，保持术语准确和原意完整。" +
  "输入是单词时给出简明且准确的释义；输入是句子或段落时仅输出完整译文，并按原文段落分行。" +
  "不要添加与翻译无关的说明。\n\n待翻译内容：\n${sourceText}";

export const DEFAULT_API_PROFILE_ID = "default-openai";

const defaults: PluginSettings = {
  autoTranslateWord: true,
  autoTranslateParagraph: true,
  loadDictionaryAudio: false,
  dictionaryPaths: "",
  dictionaryConfigs: "",
  apiProfiles: "",
  selectedApiProfileId: DEFAULT_API_PROFILE_ID,
  openaiEndpoint: "https://api.openai.com/v1/chat/completions",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  openaiTemperature: "0.2",
  targetLanguage: "简体中文",
  openaiPrompt: DEFAULT_PROMPT,
};

function fullKey(key: PrefKey): string {
  return `${config.prefsPrefix}.${key}`;
}

export function getPref<K extends PrefKey>(key: K): PluginSettings[K] {
  const value = Zotero.Prefs.get(fullKey(key), true);
  return (value === undefined ? defaults[key] : value) as PluginSettings[K];
}

export function setPref<K extends PrefKey>(
  key: K,
  value: PluginSettings[K],
): void {
  Zotero.Prefs.set(fullKey(key), value, true);
}

export function loadSettings(): PluginSettings {
  return {
    autoTranslateWord: getPref("autoTranslateWord"),
    autoTranslateParagraph: getPref("autoTranslateParagraph"),
    loadDictionaryAudio: getPref("loadDictionaryAudio"),
    dictionaryPaths: getPref("dictionaryPaths"),
    dictionaryConfigs: getPref("dictionaryConfigs"),
    apiProfiles: getPref("apiProfiles"),
    selectedApiProfileId: getPref("selectedApiProfileId"),
    openaiEndpoint: getPref("openaiEndpoint"),
    openaiApiKey: getPref("openaiApiKey"),
    openaiModel: getPref("openaiModel"),
    openaiTemperature: getPref("openaiTemperature"),
    targetLanguage: getPref("targetLanguage"),
    openaiPrompt: getPref("openaiPrompt"),
  };
}

function stablePathID(path: string): string {
  let hash = 0x811c9dc5;
  for (const character of path.toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `dictionary-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseJSONList(value: string): unknown[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDictionaryConfig(
  value: unknown,
  index: number,
): DictionaryConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<DictionaryConfig>;
  const mdxPath = stringValue(input.mdxPath).trim();
  if (!/\.mdx$/iu.test(mdxPath)) return null;
  const mddPaths = Array.isArray(input.mddPaths)
    ? parseDictionaryPaths(
        input.mddPaths
          .filter((path): path is string => typeof path === "string")
          .join("\n"),
      ).filter((path) => /\.mdd$/iu.test(path))
    : [];
  const inferredName = pathParts(mdxPath).filename.replace(/\.mdx$/iu, "");
  return {
    id:
      stringValue(input.id, stablePathID(mdxPath)) || `dictionary-${index + 1}`,
    name: stringValue(input.name, inferredName).trim() || inferredName,
    mdxPath,
    mddPaths,
    enabled: input.enabled !== false,
  };
}

export function loadDictionaryConfigs(
  settings: PluginSettings = loadSettings(),
): DictionaryConfig[] {
  const configured = parseJSONList(settings.dictionaryConfigs)
    .map(normalizeDictionaryConfig)
    .filter((value): value is DictionaryConfig => value !== null);
  if (configured.length > 0) return configured;

  return groupDictionaryPaths(
    parseDictionaryPaths(settings.dictionaryPaths),
  ).map((group) => ({
    id: stablePathID(group.mdxPath),
    name: group.name,
    mdxPath: group.mdxPath,
    mddPaths: group.mddPaths,
    enabled: true,
  }));
}

export function saveDictionaryConfigs(configs: DictionaryConfig[]): void {
  const normalized = configs
    .map(normalizeDictionaryConfig)
    .filter((value): value is DictionaryConfig => value !== null);
  setPref("dictionaryConfigs", JSON.stringify(normalized));
  setPref(
    "dictionaryPaths",
    normalized.flatMap((item) => [item.mdxPath, ...item.mddPaths]).join("\n"),
  );
}

function legacyAPIProfile(settings: PluginSettings): APIProfile {
  return {
    id: DEFAULT_API_PROFILE_ID,
    name: "OpenAI",
    endpoint: settings.openaiEndpoint,
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel,
    temperature: settings.openaiTemperature,
    targetLanguage: settings.targetLanguage,
    prompt: settings.openaiPrompt || DEFAULT_PROMPT,
  };
}

function normalizeAPIProfile(value: unknown, index: number): APIProfile | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<APIProfile>;
  const id = stringValue(input.id).trim() || `model-${index + 1}`;
  const model = stringValue(input.model).trim();
  return {
    id,
    name: stringValue(input.name).trim() || model || `模型 ${index + 1}`,
    endpoint: stringValue(input.endpoint).trim(),
    apiKey: stringValue(input.apiKey),
    model,
    temperature: stringValue(input.temperature, "0.2"),
    targetLanguage: stringValue(input.targetLanguage, "简体中文"),
    prompt: stringValue(input.prompt, DEFAULT_PROMPT) || DEFAULT_PROMPT,
  };
}

export function loadAPIProfiles(
  settings: PluginSettings = loadSettings(),
): APIProfile[] {
  const profiles = parseJSONList(settings.apiProfiles)
    .map(normalizeAPIProfile)
    .filter((value): value is APIProfile => value !== null);
  return profiles.length > 0 ? profiles : [legacyAPIProfile(settings)];
}

export function saveAPIProfiles(profiles: APIProfile[]): APIProfile[] {
  const normalized = profiles
    .map(normalizeAPIProfile)
    .filter((value): value is APIProfile => value !== null);
  const saved =
    normalized.length > 0 ? normalized : [legacyAPIProfile(loadSettings())];
  setPref("apiProfiles", JSON.stringify(saved));
  if (
    !saved.some((profile) => profile.id === getPref("selectedApiProfileId"))
  ) {
    setPref("selectedApiProfileId", saved[0]?.id || DEFAULT_API_PROFILE_ID);
  }
  return saved;
}

export function getSelectedAPIProfile(profileID?: string): APIProfile {
  const profiles = loadAPIProfiles();
  const selectedID = profileID || getPref("selectedApiProfileId");
  return (
    profiles.find((profile) => profile.id === selectedID) ||
    profiles[0] ||
    legacyAPIProfile(loadSettings())
  );
}

export function selectAPIProfile(profileID: string): void {
  if (loadAPIProfiles().some((profile) => profile.id === profileID)) {
    setPref("selectedApiProfileId", profileID);
  }
}

export function createConfigID(prefix: "dictionary" | "model"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
