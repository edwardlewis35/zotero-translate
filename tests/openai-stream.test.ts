import assert from "node:assert/strict";
import { OpenAIStreamDecoder } from "../src/openai";

const decoder = new OpenAIStreamDecoder();

let update = decoder.push(
  'data: {"model":"gpt-test","choices":[{"delta":{"content":"你',
);
assert.equal(update.text, "");

update = decoder.push(
  '好"}}]}\n\ndata: {"choices":[{"delta":{"content":"，"}}]}\n',
);
assert.equal(update.delta, "你好，");
assert.equal(update.text, "你好，");
assert.equal(update.model, "gpt-test");

update = decoder.push(
  '\ndata: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
);
assert.equal(update.delta, "世界");
assert.equal(update.text, "你好，世界");
assert.equal(update.done, true);

const responsesDecoder = new OpenAIStreamDecoder();
responsesDecoder.push(
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"流式"}\n\n',
);
const responsesUpdate = responsesDecoder.push(
  'data: {"type":"response.output_text.delta","delta":"响应"}\n\ndata: {"type":"response.completed"}\n\n',
  true,
);
assert.equal(responsesUpdate.text, "流式响应");
assert.equal(responsesUpdate.done, true);

const jsonLinesDecoder = new OpenAIStreamDecoder();
jsonLinesDecoder.push('{"model":"local","message":{"content":"本地"}}\n');
const jsonLinesUpdate = jsonLinesDecoder.push(
  '{"message":{"content":"模型"},"done":true}\n',
  true,
);
assert.equal(jsonLinesUpdate.text, "本地模型");
assert.equal(jsonLinesUpdate.done, true);

console.log("OpenAI-compatible stream decoder: passed");
