import { resolveAPIEndpoint } from "./api-endpoint";
import { getSelectedAPIProfile, type APIProfile } from "./prefs";
import {
  looksLikeHTML,
  OpenAIStreamDecoder,
  parseOpenAIResponse,
  type StreamChunk,
} from "./openai-stream";

export { OpenAIStreamDecoder } from "./openai-stream";

export interface OpenAITranslation {
  text: string;
  model: string;
  profileID: string;
  profileName: string;
}

export interface TranslationProgress extends OpenAITranslation {
  delta: string;
}

export interface TranslateOptions {
  profile?: APIProfile;
  onProgress?: (progress: TranslationProgress) => void;
  registerCancel?: (cancel: () => void) => void;
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
      const parsed = JSON.parse(xhr.responseText) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsed.error?.message || parsed.message || "";
    } catch {
      detail = looksLikeHTML(xhr.responseText)
        ? "接口返回了 HTML 页面，请检查 Base URL 和 API 协议"
        : xhr.responseText.slice(0, 300);
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
  options: TranslateOptions = {},
): Promise<OpenAITranslation> {
  const profile = options.profile || getSelectedAPIProfile();
  const protocol = profile.protocol ?? "responses";
  if (!profile.endpoint.trim())
    throw new Error(`请先填写“${profile.name}”的接口地址`);
  const endpoint = resolveAPIEndpoint(profile.endpoint, protocol);
  const model = profile.model.trim();
  if (!model) throw new Error(`请先填写“${profile.name}”的模型名称`);

  const temperatureValue = Number(profile.temperature);
  const temperature = Number.isFinite(temperatureValue)
    ? Math.min(2, Math.max(0, temperatureValue))
    : 0.2;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  if (profile.apiKey.trim())
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
  const input = [
    {
      role: "user",
      content: renderPrompt(profile.prompt, sourceText, profile.targetLanguage),
    },
  ];
  const body = {
    model,
    ...(protocol === "responses"
      ? { input, store: false }
      : { messages: input }),
    temperature,
    stream: true,
  };

  const decoder = new OpenAIStreamDecoder(protocol);
  let processedLength = 0;
  let cancelled = false;
  const notify = (state: StreamChunk) => {
    if (cancelled || state.error || (!state.delta && !state.done)) return;
    options.onProgress?.({
      text: state.text,
      delta: state.delta,
      model: state.model || model,
      profileID: profile.id,
      profileName: profile.name,
    });
  };

  let xhr: XMLHttpRequest;
  try {
    xhr = await Zotero.HTTP.request("POST", endpoint, {
      headers,
      body: JSON.stringify(body),
      responseType: "text",
      timeout: 120000,
      errorDelayMax: 0,
      cancellerReceiver: (cancel: () => void) => {
        options.registerCancel?.(() => {
          cancelled = true;
          cancel();
        });
      },
      requestObserver: (request: XMLHttpRequest) => {
        request.onprogress = () => {
          if (cancelled || request.status >= 400) return;
          const current =
            request.responseText || String(request.response || "");
          const chunk = current.slice(processedLength);
          processedLength = current.length;
          if (chunk) notify(decoder.push(chunk));
        };
      },
    });
  } catch (error) {
    if (cancelled) throw new Error("翻译请求已取消");
    throw readableRequestError(error);
  }
  if (cancelled) throw new Error("翻译请求已取消");
  if (xhr.status >= 400) throw readableRequestError({ xmlHttpRequest: xhr });

  const complete =
    xhr.responseText || (typeof xhr.response === "string" ? xhr.response : "");
  if (looksLikeHTML(complete)) {
    throw new Error("接口返回了 HTML 页面，请检查 Base URL 和 API 协议");
  }
  // Complete JSON is intentionally validated separately from streamed events.
  // This also handles pretty-printed JSON and responseType overrides by providers.
  let json: unknown;
  let isJSON = false;
  try {
    json =
      xhr.response && typeof xhr.response === "object"
        ? xhr.response
        : JSON.parse(complete);
    isJSON = true;
  } catch {
    // SSE and JSON-lines require incremental decoding below.
  }
  let text: string;
  let responseModel: string;
  if (isJSON) {
    const response = parseOpenAIResponse(json);
    text = response.text;
    responseModel = response.model || model;
    notify({ text, delta: text, model: responseModel, done: true, error: "" });
  } else {
    if (complete.length > processedLength)
      notify(decoder.push(complete.slice(processedLength)));
    notify(decoder.push("", true));
    if (decoder.error) throw new Error(decoder.error);
    if (!decoder.done)
      throw new Error("接口返回的不是有效 JSON 或完整 SSE 数据");
    text = decoder.text.trim();
    responseModel = decoder.model || model;
    if (!text) throw new Error("接口响应中没有可显示的翻译内容");
  }

  return {
    text,
    model: responseModel,
    profileID: profile.id,
    profileName: profile.name,
  };
}
