import { loadSettings, type PluginSettings } from "./prefs";

export interface OpenAITranslation {
  text: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        string | Array<{ type?: string; text?: string; content?: string }>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
  model?: string;
}

function renderPrompt(
  template: string,
  sourceText: string,
  targetLanguage: string,
): string {
  const hasSourcePlaceholder = template.includes("${sourceText}");
  const rendered = template
    .split("${sourceText}")
    .join(sourceText)
    .split("${targetLanguage}")
    .join(targetLanguage);
  return hasSourcePlaceholder
    ? rendered
    : `${rendered.trim()}\n\n待翻译内容：\n${sourceText}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const value = part as { text?: unknown; content?: unknown };
        if (typeof value.text === "string") return value.text;
        if (typeof value.content === "string") return value.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseResponse(xhr: XMLHttpRequest): ChatCompletionResponse {
  if (xhr.response && typeof xhr.response === "object") {
    return xhr.response as ChatCompletionResponse;
  }
  try {
    return JSON.parse(xhr.responseText) as ChatCompletionResponse;
  } catch {
    throw new Error("接口返回的不是有效 JSON");
  }
}

function readableRequestError(error: unknown): Error {
  const value = error as {
    message?: string;
    status?: number;
    xmlHttpRequest?: XMLHttpRequest;
  };
  const xhr = value?.xmlHttpRequest;
  let detail = "";
  if (xhr?.responseText) {
    try {
      const parsed = JSON.parse(xhr.responseText) as ChatCompletionResponse;
      detail = parsed.error?.message || "";
    } catch {
      detail = xhr.responseText.slice(0, 300);
    }
  }
  const status = xhr?.status || value?.status;
  const message =
    detail ||
    value?.message ||
    (status ? `HTTP ${status}` : "无法连接翻译接口");
  return new Error(status ? `请求失败（HTTP ${status}）：${message}` : message);
}

export async function translateWithOpenAI(
  sourceText: string,
  settings: PluginSettings = loadSettings(),
): Promise<OpenAITranslation> {
  const endpoint = settings.openaiEndpoint.trim();
  const model = settings.openaiModel.trim();
  if (!endpoint) throw new Error("请先填写 OpenAI-compatible 接口地址");
  if (!model) throw new Error("请先填写模型名称");

  let parsedURL: URL;
  try {
    parsedURL = new URL(endpoint);
  } catch {
    throw new Error("接口地址格式无效");
  }
  if (!["http:", "https:"].includes(parsedURL.protocol)) {
    throw new Error("接口地址必须使用 http:// 或 https://");
  }

  const temperatureValue = Number(settings.openaiTemperature);
  const temperature = Number.isFinite(temperatureValue)
    ? Math.min(2, Math.max(0, temperatureValue))
    : 0.2;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.openaiApiKey.trim()) {
    headers.Authorization = `Bearer ${settings.openaiApiKey.trim()}`;
  }

  let xhr: XMLHttpRequest;
  try {
    xhr = await Zotero.HTTP.request("POST", endpoint, {
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: renderPrompt(
              settings.openaiPrompt,
              sourceText,
              settings.targetLanguage,
            ),
          },
        ],
        temperature,
        stream: false,
      }),
      responseType: "json",
      timeout: 60000,
      errorDelayMax: 0,
    });
  } catch (error) {
    throw readableRequestError(error);
  }

  const response = parseResponse(xhr);
  if (response.error?.message) {
    throw new Error(response.error.message);
  }
  const choice = response.choices?.[0];
  const text =
    contentToText(choice?.message?.content) ||
    (typeof choice?.text === "string" ? choice.text.trim() : "");
  if (!text) {
    throw new Error("接口响应中没有 choices[0].message.content");
  }
  return {
    text,
    model: response.model || model,
  };
}
