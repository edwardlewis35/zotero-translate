import type { APIProtocol } from "./api-endpoint";

interface ResponseContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface ResponseOutput {
  id?: string;
  type?: string;
  role?: string;
  content?: ResponseContent[];
}

interface APIResponse {
  object?: string;
  type?: string;
  status?: string;
  model?: string;
  error?: { message?: string; code?: string } | string | null;
  incomplete_details?: { reason?: string };
  output?: ResponseOutput[];
  output_text?: string;
  response?: APIResponse | string;
  choices?: Array<{
    delta?: { content?: unknown; refusal?: string };
    message?: { content?: unknown; refusal?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
  message?: { content?: string } | string;
  delta?: string;
  text?: string;
  refusal?: string;
  done?: boolean;
  output_index?: number;
  content_index?: number;
  item_id?: string;
  item?: ResponseOutput;
  part?: ResponseContent;
  sequence_number?: number;
}

export interface StreamChunk {
  text: string;
  delta: string;
  model: string;
  done: boolean;
  error: string;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => {
      if (!part || typeof part !== "object") return "";
      const value = part as { type?: string; text?: string; content?: string };
      // Reasoning and tool arguments are never translation content.
      if (value.type && !["text", "output_text"].includes(value.type)) {
        return "";
      }
      return value.text || value.content || "";
    })
    .join("");
}

function errorMessage(error: APIResponse["error"]): string {
  return typeof error === "string"
    ? error
    : error?.message || error?.code || "";
}

function responseError(response: APIResponse, eventType = ""): string {
  const error = errorMessage(response.error);
  if (error) return error;
  if (eventType === "error") {
    return typeof response.message === "string"
      ? response.message
      : "翻译接口返回错误";
  }
  if (response.status === "failed" || eventType === "response.failed") {
    return "翻译接口生成失败";
  }
  if (response.status === "incomplete" || eventType === "response.incomplete") {
    const reason = response.incomplete_details?.reason;
    return `接口生成未完成${reason ? `（${reason}）` : ""}，请重试或调整模型设置`;
  }
  if (response.status === "cancelled") return "接口生成已取消";
  return "";
}

function outputRefusal(output: ResponseOutput[] | undefined): string {
  for (const item of output || []) {
    for (const part of item.content || []) {
      if (part.type === "refusal") {
        return `模型拒绝了翻译请求${part.refusal ? `：${part.refusal}` : ""}`;
      }
    }
  }
  return "";
}

function isMessage(item: ResponseOutput): boolean {
  return (
    (!item.type || item.type === "message") &&
    (!item.role || item.role === "assistant")
  );
}

function outputText(output: ResponseOutput[] | undefined): string {
  return (output || [])
    .filter(isMessage)
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function chatFinishError(reason: string | null | undefined): string {
  if (reason === "length") return "接口生成未完成（达到输出长度限制），请重试";
  if (reason === "content_filter") return "模型拒绝了翻译请求（内容过滤）";
  return "";
}

export function looksLikeHTML(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body|<title|<h[1-6]|<div)/iu.test(
    text,
  );
}

/** Handles providers that ignore stream=true and return a complete JSON result. */
export function parseOpenAIResponse(value: unknown): {
  text: string;
  model: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("接口返回的不是有效 JSON 对象");
  }
  const outer = value as APIResponse;
  const response =
    outer.response && typeof outer.response === "object"
      ? outer.response
      : outer;
  const error =
    responseError(response, outer.type) || responseError(outer, outer.type);
  if (error) throw new Error(error);
  const outputError = outputRefusal(response.output);
  if (outputError) throw new Error(outputError);
  const refusal =
    response.choices?.[0]?.message?.refusal ||
    response.choices?.[0]?.delta?.refusal;
  if (refusal) throw new Error(`模型拒绝了翻译请求：${refusal}`);
  if (
    response.status &&
    response.status !== "completed" &&
    (response.object === "response" ||
      response.output ||
      outer.type?.startsWith("response."))
  ) {
    throw new Error(`接口生成未完成（${response.status}），请重试`);
  }
  if (
    outer.type?.startsWith("response.") &&
    outer.type !== "response.completed"
  ) {
    throw new Error("流式响应提前结束，未收到完成事件");
  }
  const choice = response.choices?.[0];
  const finishError = chatFinishError(choice?.finish_reason);
  if (finishError) throw new Error(finishError);
  if (
    response.done === false ||
    (choice?.delta && !choice.message && choice.finish_reason == null)
  ) {
    throw new Error("流式响应提前结束，未收到完成事件");
  }
  const text =
    outputText(response.output) ||
    response.output_text ||
    contentToText(choice?.message?.content) ||
    contentToText(choice?.delta?.content) ||
    (typeof choice?.text === "string" ? choice.text : "") ||
    (typeof response.message === "object"
      ? response.message?.content || ""
      : "") ||
    (typeof response.response === "string" ? response.response : "");
  if (!text.trim()) throw new Error("接口响应中没有可显示的翻译内容");
  return { text: text.trim(), model: response.model || outer.model || "" };
}

/** Decodes framed SSE and JSON-lines without depending on network chunk boundaries. */
export class OpenAIStreamDecoder {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName = "";
  private accumulated = "";
  private currentModel = "";
  private finished = false;
  private streamError = "";
  private streamObserved = false;
  private responseStream = false;
  private parts = new Map<
    string,
    { output: number; content: number; text: string }
  >();
  private itemIndices = new Map<string, number>();
  private sequences = new Set<number>();

  constructor(protocol?: APIProtocol) {
    this.responseStream = protocol === "responses";
  }

  push(chunk: string, flush = false): StreamChunk {
    const previous = this.accumulated;
    this.buffer += chunk;
    // A trailing CR waits for the next chunk so a split CRLF is one newline.
    const delimiters = /\r\n|\r|\n/gu;
    let consumed = 0;
    for (
      let match = delimiters.exec(this.buffer);
      match;
      match = delimiters.exec(this.buffer)
    ) {
      const end = match.index + match[0].length;
      if (!flush && match[0] === "\r" && end === this.buffer.length) break;
      this.readLine(this.buffer.slice(consumed, match.index));
      consumed = end;
    }
    this.buffer = this.buffer.slice(consumed);
    if (flush) {
      if (this.buffer) this.readLine(this.buffer);
      this.buffer = "";
      this.dispatchFrame();
      if (this.streamObserved && !this.finished && !this.streamError) {
        this.streamError = "流式响应提前结束，未收到完成事件";
      }
    }
    return {
      text: this.accumulated,
      delta: this.accumulated.startsWith(previous)
        ? this.accumulated.slice(previous.length)
        : this.accumulated,
      model: this.currentModel,
      done: this.finished && !this.streamError,
      error: this.streamError,
    };
  }

  private readLine(line: string): void {
    if (!line) {
      this.dispatchFrame();
      return;
    }
    if (line.startsWith(":")) {
      this.streamObserved = true;
      return;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      this.streamObserved = true;
      this.dataLines.push(value);
    } else if (field === "event") {
      this.streamObserved = true;
      this.eventName = value;
    } else if (field === "id" || field === "retry") {
      this.streamObserved = true;
    } else if (line.trimStart().startsWith("{")) {
      // Plain NDJSON is used by local compatible servers.
      try {
        this.readEvent(JSON.parse(line) as APIResponse);
      } catch {
        // A pretty-printed ordinary JSON body is parsed by parseOpenAIResponse.
      }
    }
  }

  private dispatchFrame(): void {
    const payload = this.dataLines.join("\n");
    const name = this.eventName;
    this.dataLines = [];
    this.eventName = "";
    if (!payload) return;
    if (payload.trim() === "[DONE]") {
      // Responses requires response.completed; [DONE] is a Chat sentinel.
      if (!this.responseStream) this.finished = true;
      return;
    }
    try {
      const event = JSON.parse(payload) as APIResponse;
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error("not an event object");
      }
      this.readEvent(event, name);
    } catch {
      this.streamError ||= "接口返回了无效的 SSE JSON 数据";
    }
  }

  private partIndex(event: APIResponse): { output: number; content: number } {
    return {
      output:
        event.output_index ?? this.itemIndices.get(event.item_id || "") ?? 0,
      content: event.content_index ?? 0,
    };
  }

  private updatePart(
    output: number,
    content: number,
    text: string,
    append = false,
  ): void {
    const key = `${output}:${content}`;
    this.parts.set(key, {
      output,
      content,
      text: append ? (this.parts.get(key)?.text || "") + text : text,
    });
    this.accumulated = [...this.parts.values()]
      .sort((a, b) => a.output - b.output || a.content - b.content)
      .map((part) => part.text)
      .join("");
  }

  private readItem(item: ResponseOutput, output: number): void {
    if (item.id) this.itemIndices.set(item.id, output);
    const refusal = outputRefusal([item]);
    if (refusal) this.streamError ||= refusal;
    if (!isMessage(item)) return;
    for (const [content, part] of (item.content || []).entries()) {
      if (part.type === "output_text")
        this.updatePart(output, content, part.text || "");
    }
  }

  private readEvent(event: APIResponse, name = ""): void {
    const type = event.type || name;
    if (type.startsWith("response.")) {
      this.responseStream = true;
      this.streamObserved = true;
    }
    if (typeof event.sequence_number === "number") {
      if (this.sequences.has(event.sequence_number)) return;
      this.sequences.add(event.sequence_number);
    }
    const response =
      event.response && typeof event.response === "object"
        ? event.response
        : undefined;
    this.currentModel = response?.model || event.model || this.currentModel;
    const error =
      (response ? responseError(response, type) : "") ||
      responseError(event, type);
    if (error) {
      this.streamError ||= error;
      return;
    }
    if (this.streamError) return;

    if (type.startsWith("response.")) {
      if (
        type === "response.output_text.delta" ||
        type === "response.output_text.done"
      ) {
        const { output, content } = this.partIndex(event);
        if (type.endsWith(".delta") && typeof event.delta === "string") {
          this.updatePart(output, content, event.delta, true);
        } else if (typeof event.text === "string") {
          this.updatePart(output, content, event.text);
        }
      } else if (
        type === "response.refusal.delta" ||
        type === "response.refusal.done"
      ) {
        this.streamError = `模型拒绝了翻译请求${event.refusal || event.delta ? `：${event.refusal || event.delta}` : ""}`;
      } else if (
        type === "response.output_item.added" ||
        type === "response.output_item.done"
      ) {
        if (event.item) this.readItem(event.item, event.output_index ?? 0);
      } else if (
        type === "response.content_part.done" ||
        type === "response.content_part.added"
      ) {
        const { output, content } = this.partIndex(event);
        if (event.part?.type === "output_text") {
          this.updatePart(output, content, event.part.text || "");
        } else if (event.part?.type === "refusal") {
          this.streamError = `模型拒绝了翻译请求${event.part.refusal ? `：${event.part.refusal}` : ""}`;
        }
      } else if (type === "response.completed") {
        if (response?.status && response.status !== "completed") {
          this.streamError = `接口生成未完成（${response.status}），请重试`;
          return;
        }
        if (response?.output) {
          this.parts.clear();
          this.accumulated = "";
          response.output.forEach((item, output) =>
            this.readItem(item, output),
          );
        } else if (typeof response?.output_text === "string") {
          this.parts.clear();
          this.updatePart(0, 0, response.output_text);
        }
        this.finished = !this.streamError;
      }
      // Reasoning/tool events and text.done are not whole-response completion.
      return;
    }

    const choice = event.choices?.[0];
    const refusal = choice?.delta?.refusal || choice?.message?.refusal;
    if (refusal) {
      this.streamError = `模型拒绝了翻译请求：${refusal}`;
      return;
    }
    const finishError = chatFinishError(choice?.finish_reason);
    if (finishError) {
      this.streamError = finishError;
      return;
    }
    let piece = contentToText(choice?.delta?.content) || choice?.text || "";
    if (choice?.message?.content) {
      this.accumulated = contentToText(choice.message.content);
    } else {
      if (!piece && typeof event.message === "object")
        piece = event.message.content || "";
      if (!piece && typeof event.response === "string") piece = event.response;
      this.accumulated += piece;
    }
    if (
      choice?.delta ||
      event.done !== undefined ||
      typeof event.response === "string" ||
      typeof event.message === "object"
    ) {
      this.streamObserved = true;
    }
    if (
      !this.responseStream &&
      (choice?.finish_reason != null || event.done === true)
    )
      this.finished = true;
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
  get done(): boolean {
    return this.finished && !this.streamError;
  }
}
