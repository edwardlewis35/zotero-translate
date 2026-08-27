pref("__prefsPrefix__.autoTranslateWord", true);
pref("__prefsPrefix__.autoTranslateParagraph", true);
pref("__prefsPrefix__.dictionaryPaths", "");
pref(
  "__prefsPrefix__.openaiEndpoint",
  "https://api.openai.com/v1/chat/completions",
);
pref("__prefsPrefix__.openaiApiKey", "");
pref("__prefsPrefix__.openaiModel", "gpt-4o-mini");
pref("__prefsPrefix__.openaiTemperature", "0.2");
pref("__prefsPrefix__.targetLanguage", "简体中文");
pref(
  "__prefsPrefix__.openaiPrompt",
  "你是一名严谨的专业翻译助手。请将下面内容翻译为 ${targetLanguage}，保持术语准确和原意完整。输入是单词时给出简短释义；输入是句子或段落时仅输出译文，并按原文段落分行。不要添加与翻译无关的说明。\n\n待翻译内容：\n${sourceText}",
);
