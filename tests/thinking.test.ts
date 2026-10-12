import assert from "node:assert/strict";
import {
  buildThinkingRequestOptions,
  normalizeThinkingMode,
  normalizeThinkingParameter,
} from "../src/thinking";
import type { APIProfile } from "../src/prefs";

const profile: APIProfile = {
  id: "thinking-test",
  name: "千问",
  endpoint: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
  model: "qwen3.5-plus",
  apiKey: "",
  temperature: "0.2",
  targetLanguage: "简体中文",
  prompt: "${sourceText}",
};

for (const value of [undefined, null, "invalid", false, "off"]) {
  assert.equal(normalizeThinkingMode(value), "off");
}
assert.equal(normalizeThinkingMode("on"), "on");
assert.equal(normalizeThinkingMode("default"), "default");
assert.equal(normalizeThinkingParameter(undefined), "auto");
assert.equal(normalizeThinkingParameter("invalid"), "auto");
assert.equal(normalizeThinkingParameter("enable_thinking"), "enable_thinking");
assert.equal(normalizeThinkingParameter("reasoning"), "reasoning");

// The user's standard Base URL defaults to non-thinking Responses requests.
assert.deepEqual(buildThinkingRequestOptions(profile, "responses"), {
  parameters: { reasoning: { effort: "none" } },
  omitTemperature: false,
});
for (const mode of ["off", "on", "default"] as const) {
  for (const protocol of ["responses", "chat-completions"] as const) {
    for (const parameter of ["auto", "reasoning", "enable_thinking"] as const) {
      const actual = buildThinkingRequestOptions(
        { ...profile, thinkingMode: mode, thinkingParameter: parameter },
        protocol,
      );
      const expected =
        mode === "default"
          ? {}
          : parameter === "enable_thinking" ||
              (parameter === "auto" && protocol === "chat-completions")
            ? { enable_thinking: mode === "on" }
            : protocol === "responses"
              ? { reasoning: { effort: mode === "off" ? "none" : "medium" } }
              : { reasoning_effort: mode === "off" ? "none" : "medium" };
      assert.deepEqual(actual, {
        parameters: expected,
        omitTemperature: false,
      });
      assert.equal("extra_body" in actual.parameters, false);
    }
  }
}

// Host recognition respects domain boundaries and checks the host, not paths.
for (const endpoint of [
  "https://qianwenaiapi.com/v1",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "https://api.qwencloud.com/v1",
]) {
  assert.deepEqual(
    buildThinkingRequestOptions(
      { ...profile, endpoint, model: "alias" },
      "chat-completions",
    ).parameters,
    { enable_thinking: false },
  );
}
for (const endpoint of [
  "https://qianwenaiapi.com.attacker.example/v1",
  "https://fakealiyuncs.com/v1",
  "https://example.com/qianwenaiapi.com/v1",
]) {
  assert.deepEqual(
    buildThinkingRequestOptions(
      { ...profile, endpoint, model: "alias" },
      "chat-completions",
    ).parameters,
    { reasoning_effort: "none" },
  );
}
assert.deepEqual(
  buildThinkingRequestOptions(
    { ...profile, endpoint: "https://example.com/v1", model: "Qwen/Qwen3-32B" },
    "chat-completions",
  ).parameters,
  { enable_thinking: false },
);

const openAI = { ...profile, endpoint: "https://api.openai.com/v1" };
for (const model of [
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-3.5-turbo",
  "gpt-5-chat-latest",
]) {
  assert.deepEqual(
    buildThinkingRequestOptions({ ...openAI, model }, "responses"),
    {
      parameters: {},
      omitTemperature: false,
    },
  );
  assert.throws(
    () =>
      buildThinkingRequestOptions(
        { ...openAI, model, thinkingMode: "on" },
        "responses",
      ),
    /不支持思考模式/u,
  );
}
for (const model of [
  "o3",
  "o4-mini",
  "gpt-5",
  "gpt-5-mini",
  "gpt-6-astra",
  "gpt-6.1-sol",
]) {
  assert.throws(
    () => buildThinkingRequestOptions({ ...openAI, model }, "responses"),
    /不支持关闭思考/u,
  );
  assert.deepEqual(
    buildThinkingRequestOptions(
      { ...openAI, model, thinkingMode: "default" },
      "responses",
    ),
    { parameters: {}, omitTemperature: true },
  );
}
for (const model of ["gpt-5.1", "gpt-5.2", "gpt-5.4-mini"]) {
  assert.deepEqual(
    buildThinkingRequestOptions({ ...openAI, model }, "responses"),
    {
      parameters: { reasoning: { effort: "none" } },
      omitTemperature: false,
    },
  );
  assert.deepEqual(
    buildThinkingRequestOptions(
      { ...openAI, model, thinkingMode: "on" },
      "chat-completions",
    ),
    { parameters: { reasoning_effort: "medium" }, omitTemperature: true },
  );
}

// Explicit adapter choice supports gateways that remap otherwise recognized names.
assert.deepEqual(
  buildThinkingRequestOptions(
    { ...openAI, model: "gpt-4o", thinkingParameter: "enable_thinking" },
    "responses",
  ),
  { parameters: { enable_thinking: false }, omitTemperature: false },
);
console.log(
  "Thinking mode payloads, adapters, vendor detection and model compatibility: passed",
);
