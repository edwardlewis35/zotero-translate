import assert from "node:assert/strict";
import { translateWithOpenAI } from "../src/openai";
import type { APIProfile } from "../src/prefs";

const profile: APIProfile = {
  id: "stream-test",
  name: "流式测试",
  endpoint: "https://example.com/compatible-mode/v1/",
  apiKey: " secret ",
  model: "configured-model",
  temperature: "0.2",
  targetLanguage: "简体中文",
  prompt: "翻译为 ${targetLanguage}：${sourceText}",
};
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const delta = (text: string) => ({
  type: "response.output_text.delta",
  output_index: 0,
  content_index: 0,
  delta: text,
});
const completed = (text: string) => ({
  type: "response.completed",
  response: {
    status: "completed",
    model: "stream-model",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
  },
});

interface RequestOptions {
  body: string;
  headers: Record<string, string>;
  responseType: string;
  requestObserver: (request: XMLHttpRequest) => void;
  cancellerReceiver: (cancel: () => void) => void;
}
interface Scenario {
  chunks: string[];
  status?: number;
  object?: unknown;
  reject?: boolean;
}
let scenario: Scenario = { chunks: [] };
let requestBody: Record<string, unknown> = {};
let requestURL = "";
let requestHeaders: Record<string, string> = {};
let aborted = false;
Object.assign(globalThis, {
  Zotero: {
    HTTP: {
      request: async (method: string, url: string, options: RequestOptions) => {
        assert.equal(method, "POST");
        assert.equal(options.responseType, "text");
        requestURL = url;
        requestBody = JSON.parse(options.body) as Record<string, unknown>;
        requestHeaders = options.headers;
        aborted = false;
        const xhr = {
          responseText: "",
          response: scenario.object || "",
          status: scenario.status ?? 200,
          onprogress: null as (() => void) | null,
        };
        options.requestObserver(xhr as unknown as XMLHttpRequest);
        options.cancellerReceiver(() => {
          aborted = true;
        });
        for (const chunk of scenario.chunks) {
          xhr.responseText += chunk;
          xhr.onprogress?.();
        }
        if (scenario.reject)
          throw { message: "HTTP request failed", xmlHttpRequest: xhr };
        return xhr as unknown as XMLHttpRequest;
      },
    },
  },
});

const progressSnapshots: string[] = [];
let cancellationRegistered = false;
scenario = {
  chunks: [
    sse({
      type: "response.created",
      response: { model: "stream-model", status: "in_progress" },
    }) + sse(delta("你")),
    sse(delta("好")),
    sse({
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "你好",
    }) + sse(completed("你好")),
  ],
};
const result = await translateWithOpenAI("hello", {
  profile,
  onProgress: (progress) => progressSnapshots.push(progress.text),
  registerCancel: () => {
    cancellationRegistered = true;
  },
});
assert.equal(requestURL, "https://example.com/compatible-mode/v1/responses");
assert.equal(requestBody.stream, true);
assert.equal(requestBody.store, false);
assert.equal(requestBody.messages, undefined);
const wordInput = requestBody.input as {
  role: "system" | "user";
  content: string;
}[];
assert.equal(wordInput.length, 2);
assert.equal(wordInput[0].role, "system");
assert.match(wordInput[0].content, /完整.*词典条目/u);
assert.match(wordInput[0].content, /每个主要义项至少.*例句/u);
assert.deepEqual(wordInput[1], {
  role: "user",
  content: "翻译为 简体中文：hello",
});
assert.equal(requestBody.temperature, 0.2);
assert.equal(requestHeaders.Authorization, "Bearer secret");
assert.match(requestHeaders.Accept, /text\/event-stream/u);
assert.deepEqual(progressSnapshots.slice(0, 2), ["你", "你好"]);
assert.equal(cancellationRegistered, true);
assert.equal(result.text, "你好");
assert.equal(result.model, "stream-model");
assert.equal(result.profileName, "流式测试");

// A standard Chat Base URL uses /chat/completions and the legacy messages body.
scenario = {
  chunks: [
    'data: {"model":"chat-model","choices":[{"delta":{"content":"聊天"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"兼容"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  ],
};
const chatResult = await translateWithOpenAI("hello", {
  profile: {
    ...profile,
    protocol: "chat-completions",
    temperature: "4",
    apiKey: "",
    endpoint: "https://example.com/v1/responses?api-version=preview",
  },
});
assert.equal(
  requestURL,
  "https://example.com/v1/chat/completions?api-version=preview",
);
assert.equal(requestBody.temperature, 2);
assert.equal(requestBody.input, undefined);
assert.equal(requestBody.store, undefined);
assert.deepEqual(requestBody.messages, wordInput);
assert.equal(requestHeaders.Authorization, undefined);
assert.equal(chatResult.text, "聊天兼容");
assert.equal(chatResult.model, "chat-model");

// The actual payload switches mode after a lookup edit, for either API protocol.
scenario = { chunks: [], object: completed("测试译文").response };
await translateWithOpenAI("“went.”", { profile });
assert.equal((requestBody.input as typeof wordInput)[0].role, "system");
assert.equal(
  (requestBody.input as typeof wordInput)[1].content,
  "翻译为 简体中文：went",
);
for (const protocol of ["responses", "chat-completions"] as const) {
  await translateWithOpenAI("bank account", {
    profile: { ...profile, protocol },
  });
  assert.deepEqual(
    protocol === "responses" ? requestBody.input : requestBody.messages,
    [{ role: "user", content: "翻译为 简体中文：bank account" }],
  );
}
await translateWithOpenAI("hello", {
  profile,
  selectionMode: "translation",
});
assert.deepEqual(requestBody.input, [
  { role: "user", content: "翻译为 简体中文：hello" },
]);

// Cancellation suppresses later progress even if the transport resolves after abort.
scenario = {
  chunks: [sse(delta("部分")), sse(delta("剩余")), sse(completed("部分剩余"))],
};
let cancel: (() => void) | undefined;
const cancelSnapshots: string[] = [];
await assert.rejects(
  translateWithOpenAI("hello", {
    profile,
    registerCancel: (callback) => {
      cancel = callback;
    },
    onProgress: (progress) => {
      cancelSnapshots.push(progress.text);
      cancel?.();
    },
  }),
  /已取消/u,
);
assert.equal(aborted, true);
assert.deepEqual(cancelSnapshots, ["部分"]);

for (const [event, expected] of [
  [
    {
      type: "response.failed",
      response: { status: "failed", error: { message: "upstream failure" } },
    },
    /upstream failure/u,
  ],
  [
    {
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
    },
    /max_output_tokens/u,
  ],
  [{ type: "error", message: "upstream error" }, /upstream error/u],
  [{ type: "response.refusal.done", refusal: "blocked" }, /拒绝/u],
] as const) {
  scenario = { chunks: [sse(delta("部分")), sse(event)] };
  await assert.rejects(translateWithOpenAI("hello", { profile }), expected);
}
scenario = { chunks: [sse(delta("未完成"))] };
await assert.rejects(translateWithOpenAI("hello", { profile }), /提前结束/u);
scenario = { chunks: [sse(delta("未完成")), "data: [DONE]\n\n"] };
await assert.rejects(translateWithOpenAI("hello", { profile }), /提前结束/u);
scenario = { chunks: [sse(completed(""))] };
await assert.rejects(translateWithOpenAI("hello", { profile }), /没有/u);
scenario = { chunks: ["data: {invalid}\n\n"] };
await assert.rejects(translateWithOpenAI("hello", { profile }), /无效/u);
scenario = {
  chunks: ["<!DOCTYPE html><html><body>Gateway error</body></html>"],
};
await assert.rejects(
  translateWithOpenAI("hello", { profile }),
  /HTML.*Base URL/u,
);
scenario = {
  chunks: ['{"error":{"message":"quota exhausted"}}'],
  status: 429,
  reject: true,
};
await assert.rejects(
  translateWithOpenAI("hello", { profile }),
  /HTTP 429.*quota exhausted/u,
);
scenario = { chunks: ["<html>Bad Gateway</html>"], status: 502 };
await assert.rejects(
  translateWithOpenAI("hello", { profile }),
  /HTTP 502.*HTML/u,
);

// Providers may return an ordinary JSON response despite stream=true.
scenario = {
  chunks: [
    JSON.stringify(
      {
        object: "response",
        status: "completed",
        model: "json-model",
        output: [
          { type: "reasoning", summary: [{ text: "不显示思考" }] },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: " 普通响应 " }],
          },
        ],
      },
      null,
      2,
    ),
  ],
};
assert.deepEqual(await translateWithOpenAI("hello", { profile }), {
  text: "普通响应",
  model: "json-model",
  profileID: "stream-test",
  profileName: "流式测试",
});
scenario = {
  chunks: [],
  object: {
    model: "object-model",
    output: [
      { type: "message", content: [{ type: "output_text", text: "对象响应" }] },
    ],
  },
};
assert.equal(
  (await translateWithOpenAI("hello", { profile })).text,
  "对象响应",
);
for (const [json, expected] of [
  [{ status: "failed", error: { message: "JSON failed" } }, /JSON failed/u],
  [
    {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        { type: "message", content: [{ type: "output_text", text: "部分" }] },
      ],
    },
    /max_output_tokens/u,
  ],
  [
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "blocked" }] },
      ],
    },
    /拒绝/u,
  ],
  [{ status: "completed", output: [] }, /没有/u],
] as const) {
  scenario = { chunks: [JSON.stringify(json)] };
  await assert.rejects(translateWithOpenAI("hello", { profile }), expected);
}
scenario = {
  chunks: [
    '{"message":{"content":"本地"},"done":false}\n',
    '{"message":{"content":"完成"},"done":true}\n',
  ],
};
assert.equal(
  (
    await translateWithOpenAI("hello", {
      profile: { ...profile, protocol: "chat-completions" },
    })
  ).text,
  "本地完成",
);
scenario = { chunks: ['{"choices":[{"delta":{"content":"部分"}}]}\n'] };
await assert.rejects(
  translateWithOpenAI("hello", {
    profile: { ...profile, protocol: "chat-completions" },
  }),
  /提前结束/u,
);

console.log(
  "Responses request payload, endpoint, progress, cancellation and failures: passed",
);
