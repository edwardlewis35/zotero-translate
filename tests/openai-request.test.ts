import assert from "node:assert/strict";
import { translateWithOpenAI } from "../src/openai";
import type { APIProfile } from "../src/prefs";

let requestBody: Record<string, unknown> | undefined;
const progressSnapshots: string[] = [];
let cancellationRegistered = false;

const mockRequest = {
  responseText: "",
  response: "",
  status: 200,
  onprogress: null as (() => void) | null,
};

Object.assign(globalThis, {
  Zotero: {
    HTTP: {
      request: async (
        _method: string,
        _url: string,
        options: {
          body: string;
          requestObserver: (request: XMLHttpRequest) => void;
          cancellerReceiver: (cancel: () => void) => void;
        },
      ) => {
        requestBody = JSON.parse(options.body) as Record<string, unknown>;
        options.requestObserver(mockRequest as unknown as XMLHttpRequest);
        options.cancellerReceiver(() => undefined);

        mockRequest.responseText =
          'data: {"model":"stream-model","choices":[{"delta":{"content":"你"}}]}\n\n';
        mockRequest.onprogress?.();
        mockRequest.responseText +=
          'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        mockRequest.onprogress?.();
        return mockRequest as unknown as XMLHttpRequest;
      },
    },
  },
});

const profile: APIProfile = {
  id: "stream-test",
  name: "流式测试",
  endpoint: "https://example.com/v1/chat/completions",
  apiKey: "secret",
  model: "configured-model",
  temperature: "0.2",
  targetLanguage: "简体中文",
  prompt: "翻译为 ${targetLanguage}：${sourceText}",
};

const result = await translateWithOpenAI("hello", {
  profile,
  onProgress: (progress) => progressSnapshots.push(progress.text),
  registerCancel: () => {
    cancellationRegistered = true;
  },
});

assert.equal(requestBody?.stream, true);
assert.deepEqual(progressSnapshots.slice(0, 2), ["你", "你好"]);
assert.equal(cancellationRegistered, true);
assert.equal(result.text, "你好");
assert.equal(result.model, "stream-model");
assert.equal(result.profileName, "流式测试");

console.log("streaming request progress integration: passed");
