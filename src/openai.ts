import { getSelectedAPIProfile, type APIProfile } from "./prefs";

export interface OpenAITranslation {
  text: string;
  model: string;
  profileID: string;
  profileName: string;
}

export interface TranslationProgress {
  text: string;
  delta: string;
  model: string;
  profileID: string;
  profileName: string;
}

export interface TranslateOptions {
  profile?: APIProfile;
  onProgress?: (progress: TranslationProgress) => void;
  registerCancel?: (cancel: () => void) => void;
}

interface ChatCompletionResponse {
  choices?: Array<{
    delta?: {
      content?:
        string | Array<{ type?: string; text?: string; content?: string }>;
    };
    message?: {
      content?:
        string | Array<{ type?: string; text?: string; content?: string }>;
    };
    text?: string;
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
  message?: {
    content?: string;
  };
  response?: string;
  model?: string;
  type?: string;
  delta?: string;
  done?: boolean;
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

function contentToText(content: unknown, trim = true): string {
  let value = "";
  if (typeof content === "string") {
    value = content;
  } else if (Array.isArray(content)) {
    value = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const item = part as { text?: unknown; content?: unknown };
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return trim ? value.trim() : value;
}

function parseResponse(xhr: XMLHttpRequest): ChatCompletionResponse {
  if (xhr.response && typeof xhr.response === "object") {
    return xhr.response as ChatCompletionResponse;
  }
  try {
    return JSON.parse(xhr.responseText) as ChatCompletionResponse;
  } catch {
    throw new Error("接口返回的不是有效 JSON 或 SSE 数据");
  }
}

function responseText(response: ChatCompletionResponse): string {
  const choice = response.choices?.[0];
  return (
    contentToText(choice?.message?.content) ||
    contentToText(choice?.delta?.content) ||
    (typeof choice?.text === "string" ? choice.text.trim() : "") ||
    (typeof response.message?.content === "string"
      ? response.message.content.trim()
      : "") ||
    (typeof response.response === "string" ? response.response.trim() : "")
  );
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

interface StreamChunk {
  text: string;
  delta: string;
  model: string;
  done: boolean;
  error: string;
}

/**
 * Incrementally decodes OpenAI-compatible SSE and common JSON-lines variants.
 * Keeping this state separate makes partial network chunks safe to process.
 */
export class OpenAIStreamDecoder {
  private buffer = "";
  private accumulated = "";
  private currentModel = "";
  private finished = false;
  private streamError = "";

  push(chunk: string, flush = false): StreamChunk {
    this.buffer += chunk.replace(/\r\n?/gu, "\n");
    const lines = this.buffer.split("\n");
    const trailing = lines.pop() || "";
    this.buffer = flush ? "" : trailing;
    if (flush && trailing) lines.push(trailing);

    let delta = "";
    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith(":") || line.startsWith("event:")) {
        continue;
      }
      if (line.startsWith("data:")) {
        line = line.slice(5).trimStart();
      }
      if (!line) continue;
      if (line === "[DONE]") {
        this.finished = true;
        continue;
      }

      let event: ChatCompletionResponse;
      try {
        event = JSON.parse(line) as ChatCompletionResponse;
      } catch {
        if (!flush) {
          this.buffer = rawLine + (this.buffer ? `\n${this.buffer}` : "");
        }
        continue;
      }

      if (event.error?.message) {
        this.streamError = event.error.message;
        continue;
      }
      if (event.model) this.currentModel = event.model;

      const choice = event.choices?.[0];
      let piece =
        contentToText(choice?.delta?.content, false) ||
        (typeof choice?.text === "string" ? choice.text : "");
      let snapshot = false;

      if (!piece && event.type === "response.output_text.delta") {
        piece = typeof event.delta === "string" ? event.delta : "";
      }
      if (!piece && typeof event.message?.content === "string") {
        piece = event.message.content;
      }
      if (!piece && typeof event.response === "string") {
        piece = event.response;
      }
      if (!piece && choice?.message?.content) {
        piece = contentToText(choice.message.content, false);
        snapshot = true;
      }

      if (piece) {
        if (snapshot && piece.startsWith(this.accumulated)) {
          piece = piece.slice(this.accumulated.length);
        } else if (snapshot && this.accumulated.startsWith(piece)) {
          piece = "";
        }
        this.accumulated += piece;
        delta += piece;
      }

      if (
        choice?.finish_reason !== undefined &&
        choice.finish_reason !== null
      ) {
        this.finished = true;
      }
      if (
        event.done === true ||
        event.type === "response.completed" ||
        event.type === "response.done"
      ) {
        this.finished = true;
      }
    }

    return {
      text: this.accumulated,
      delta,
      model: this.currentModel,
      done: this.finished,
      error: this.streamError,
    };
  }

  get text(): string {
    return this.accumulated;
  }

  get model(): string {
    return this.currentModel;
  }

  get error(): string {
    return this.streamError;
  }
}

export async function translateWithOpenAI(
  sourceText: string,
  options: TranslateOptions = {},
): Promise<OpenAITranslation> {
  const profile = options.profile || getSelectedAPIProfile();
  const endpoint = profile.endpoint.trim();
  const model = profile.model.trim();
  if (!endpoint) throw new Error(`请先填写“${profile.name}”的接口地址`);
  if (!model) throw new Error(`请先填写“${profile.name}”的模型名称`);

  let parsedURL: URL;
  try {
    parsedURL = new URL(endpoint);
  } catch {
    throw new Error("接口地址格式无效");
  }
  if (!["http:", "https:"].includes(parsedURL.protocol)) {
    throw new Error("接口地址必须使用 http:// 或 https://");
  }

  const temperatureValue = Number(profile.temperature);
  const temperature = Number.isFinite(temperatureValue)
    ? Math.min(2, Math.max(0, temperatureValue))
    : 0.2;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (profile.apiKey.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
  }

  const decoder = new OpenAIStreamDecoder();
  let processedLength = 0;
  const notify = (state: StreamChunk) => {
    if (!state.delta && !state.done) return;
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
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: renderPrompt(
              profile.prompt,
              sourceText,
              profile.targetLanguage,
            ),
          },
        ],
        temperature,
        stream: true,
      }),
      responseType: "text",
      timeout: 120000,
      errorDelayMax: 0,
      cancellerReceiver: (cancel: () => void) => {
        options.registerCancel?.(cancel);
      },
      requestObserver: (request: XMLHttpRequest) => {
        request.onprogress = () => {
          const current =
            request.responseText || String(request.response || "");
          const chunk = current.slice(processedLength);
          processedLength = current.length;
          if (chunk) notify(decoder.push(chunk));
        };
      },
    });
  } catch (error) {
    throw readableRequestError(error);
  }

  const complete = xhr.responseText || String(xhr.response || "");
  if (complete.length > processedLength) {
    notify(decoder.push(complete.slice(processedLength)));
  }
  notify(decoder.push("", true));

  if (decoder.error) throw new Error(decoder.error);
  let text = decoder.text.trim();
  let responseModel = decoder.model || model;

  // Some compatible servers ignore stream=true and return one JSON response.
  if (!text) {
    const response = parseResponse(xhr);
    if (response.error?.message) throw new Error(response.error.message);
    text = responseText(response);
    responseModel = response.model || model;
  }
  if (!text) {
    throw new Error("接口响应中没有可显示的翻译内容");
  }

  return {
    text,
    model: responseModel,
    profileID: profile.id,
    profileName: profile.name,
  };
}
