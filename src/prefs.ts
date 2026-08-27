import { config } from "./config";

export interface PluginSettings {
  autoTranslateWord: boolean;
  autoTranslateParagraph: boolean;
  dictionaryPaths: string;
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
  "输入是单词时给出简短释义；输入是句子或段落时仅输出译文，并按原文段落分行。" +
  "不要添加与翻译无关的说明。\n\n待翻译内容：\n${sourceText}";

const defaults: PluginSettings = {
  autoTranslateWord: true,
  autoTranslateParagraph: true,
  dictionaryPaths: "",
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
    dictionaryPaths: getPref("dictionaryPaths"),
    openaiEndpoint: getPref("openaiEndpoint"),
    openaiApiKey: getPref("openaiApiKey"),
    openaiModel: getPref("openaiModel"),
    openaiTemperature: getPref("openaiTemperature"),
    targetLanguage: getPref("targetLanguage"),
    openaiPrompt: getPref("openaiPrompt"),
  };
}
