import assert from "node:assert/strict";
import { OpenAIStreamDecoder } from "../src/openai";
import { parseOpenAIResponse } from "../src/openai-stream";

const sse = (event: unknown, newline = "\n") =>
  `data: ${JSON.stringify(event)}${newline}${newline}`;
const delta = (text: string, output = 0, content = 0) => ({
  type: "response.output_text.delta",
  output_index: output,
  content_index: content,
  delta: text,
});
const completed = (output?: unknown[]) => ({
  type: "response.completed",
  response: {
    status: "completed",
    model: "response-model",
    ...(output ? { output } : {}),
  },
});
const message = (text: string) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});

const chat = new OpenAIStreamDecoder("chat-completions");
let state = chat.push(
  'data: {"model":"gpt-test","choices":[{"delta":{"content":"你',
);
assert.equal(state.text, "");
state = chat.push(
  '好"}}]}\n\ndata: {"choices":[{"delta":{"content":"，"}}]}\n\n',
);
assert.equal(state.delta, "你好，");
assert.equal(state.model, "gpt-test");
state = chat.push(
  'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  true,
);
assert.equal(state.text, "你好，世界");
assert.equal(state.done, true);
assert.equal(state.error, "");

const responseStream =
  ': keepalive\r\nid: event-1\r\nretry: 500\r\nevent: response.created\r\ndata: {"type":"response.created",\r\ndata: "response":{"model":"response-model","status":"in_progress"}}\r\n\r\n' +
  sse(
    { type: "response.reasoning_text.delta", delta: "不要显示思考" },
    "\r\n",
  ) +
  sse(
    {
      type: "response.function_call_arguments.delta",
      delta: "不要显示工具参数",
    },
    "\r\n",
  ) +
  sse(delta("流式"), "\r\n") +
  sse(delta("响应"), "\r\n") +
  sse(
    {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "流式响应",
    },
    "\r\n",
  ) +
  sse(completed([message("流式响应")]), "\r\n");
// Every possible two-chunk boundary includes splits inside JSON, UTF-16 and CRLF.
for (let split = 0; split <= responseStream.length; split++) {
  const decoder = new OpenAIStreamDecoder("responses");
  decoder.push(responseStream.slice(0, split));
  const update = decoder.push(responseStream.slice(split), true);
  assert.equal(update.text, "流式响应", `boundary ${split}`);
  assert.equal(update.model, "response-model");
  assert.equal(update.done, true);
  assert.equal(update.error, "");
}
const characterChunks = new OpenAIStreamDecoder("responses");
for (const character of responseStream) characterChunks.push(character);
assert.equal(characterChunks.push("", true).text, "流式响应");

// Output/content snapshots correct their own part and never duplicate streamed text.
const parts = new OpenAIStreamDecoder("responses");
parts.push(sse(delta("后", 1, 1)));
parts.push(sse(delta("前", 1, 0)));
assert.equal(parts.text, "前后");
parts.push(
  sse({
    type: "response.output_text.done",
    output_index: 1,
    content_index: 0,
    text: "前文",
  }),
);
assert.equal(parts.text, "前文后");
state = parts.push(
  sse(
    completed([
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "思考" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "前文" },
          { type: "output_text", text: "后文" },
        ],
      },
      message("结尾"),
    ]),
  ),
  true,
);
assert.equal(state.text, "前文后文结尾");
assert.equal(state.done, true);

const itemSnapshots = new OpenAIStreamDecoder("responses");
itemSnapshots.push(
  sse({
    type: "response.output_item.added",
    output_index: 2,
    item: { id: "msg", type: "message", content: [] },
  }),
);
itemSnapshots.push(
  sse({
    type: "response.output_text.delta",
    item_id: "msg",
    content_index: 0,
    delta: "原",
  }),
);
itemSnapshots.push(
  sse({
    type: "response.content_part.done",
    output_index: 2,
    content_index: 0,
    part: { type: "output_text", text: "原文" },
  }),
);
itemSnapshots.push(
  sse({
    type: "response.output_item.done",
    output_index: 2,
    item: message("原文"),
  }),
);
state = itemSnapshots.push(sse(completed()), true);
assert.equal(state.text, "原文");
assert.equal(state.done, true);

const replay = new OpenAIStreamDecoder("responses");
const replayDelta = { ...delta("一"), sequence_number: 1 };
replay.push(sse(replayDelta) + sse(replayDelta) + sse(completed()));
assert.equal(replay.text, "一");

const textDoneOnly = new OpenAIStreamDecoder("responses");
state = textDoneOnly.push(
  sse(delta("片段")) +
    sse({ type: "response.output_text.done", text: "片段" }) +
    "data: [DONE]\n\n",
  true,
);
assert.equal(state.done, false);
assert.match(state.error, /提前结束/u);

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
  [
    { type: "error", message: "upstream stream error" },
    /upstream stream error/u,
  ],
  [{ type: "response.refusal.delta", delta: "cannot translate" }, /拒绝/u],
  [{ type: "response.refusal.done", refusal: "cannot translate" }, /拒绝/u],
  [
    completed([
      { type: "message", content: [{ type: "refusal", refusal: "blocked" }] },
    ]),
    /拒绝/u,
  ],
] as const) {
  const decoder = new OpenAIStreamDecoder("responses");
  state = decoder.push(
    sse(delta("部分译文")) + sse(event) + sse(completed()),
    true,
  );
  assert.equal(state.done, false);
  assert.match(state.error, expected);
}

const malformed = new OpenAIStreamDecoder("responses");
assert.match(malformed.push("data: {broken}\n\n", true).error, /无效/u);
const truncatedJSON = new OpenAIStreamDecoder("responses");
assert.match(
  truncatedJSON.push(
    'data: {"type":"response.output_text.delta","delta":"x',
    true,
  ).error,
  /无效/u,
);
const noBlankAtEnd = new OpenAIStreamDecoder("responses");
state = noBlankAtEnd.push(
  sse(delta("完整")) + `data: ${JSON.stringify(completed())}`,
  true,
);
assert.equal(state.done, true);
assert.equal(state.text, "完整");

const jsonLines = new OpenAIStreamDecoder("chat-completions");
jsonLines.push('{"model":"local","message":{"content":"本地"}}\n');
state = jsonLines.push('{"message":{"content":"模型"},"done":true}\n', true);
assert.equal(state.text, "本地模型");
assert.equal(state.done, true);
const truncatedLines = new OpenAIStreamDecoder("chat-completions");
assert.match(
  truncatedLines.push('{"message":{"content":"部分"}}\n', true).error,
  /提前结束/u,
);

assert.deepEqual(
  parseOpenAIResponse({
    status: "completed",
    model: "json-model",
    output: [
      { type: "reasoning", content: [{ type: "output_text", text: "不显示" }] },
      message("普通 JSON"),
      { type: "function_call", arguments: "不显示" },
    ],
  }),
  { text: "普通 JSON", model: "json-model" },
);
assert.equal(parseOpenAIResponse({ output_text: "兼容输出" }).text, "兼容输出");
assert.throws(
  () => parseOpenAIResponse({ status: "failed", output: [message("部分")] }),
  /失败/u,
);
assert.throws(
  () =>
    parseOpenAIResponse({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output: [message("部分")],
    }),
  /content_filter/u,
);
assert.throws(
  () =>
    parseOpenAIResponse({ status: "in_progress", output: [message("部分")] }),
  /未完成/u,
);
assert.throws(
  () =>
    parseOpenAIResponse({
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "blocked" }] },
      ],
    }),
  /拒绝/u,
);
assert.throws(
  () =>
    parseOpenAIResponse({ type: "response.output_text.delta", delta: "部分" }),
  /提前结束/u,
);
assert.throws(
  () =>
    parseOpenAIResponse({
      output: [{ type: "reasoning", summary: [{ text: "思考" }] }],
    }),
  /没有/u,
);

// A Responses request must not be completed by another protocol's sentinel.
for (const event of [
  { choices: [{ delta: { content: "部分" }, finish_reason: "stop" }] },
  { message: { content: "部分" }, done: true },
]) {
  const mismatch = new OpenAIStreamDecoder("responses");
  const update = mismatch.push(
    `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
    true,
  );
  assert.equal(update.done, false);
  assert.match(update.error, /提前结束/u);
}

console.log(
  "Responses, Chat SSE, JSON-lines and JSON response decoding: passed",
);
