import type { APIProtocol } from "./api-endpoint";
import type { APIProfile, ThinkingMode, ThinkingParameter } from "./prefs";

type ThinkingParameters =
  | { reasoning: { effort: "none" | "medium" } }
  | { reasoning_effort: "none" | "medium" }
  | { enable_thinking: boolean }
  | Record<string, never>;

export interface ThinkingRequestOptions {
  parameters: ThinkingParameters;
  omitTemperature: boolean;
}

export function normalizeThinkingMode(value: unknown): ThinkingMode {
  return value === "on" || value === "default" ? value : "off";
}

export function normalizeThinkingParameter(value: unknown): ThinkingParameter {
  return value === "reasoning" || value === "enable_thinking" ? value : "auto";
}

function isQwenEndpoint(endpoint: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ["qianwenaiapi.com", "aliyuncs.com", "qwencloud.com"].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function isQwenModel(model: string): boolean {
  return /(?:^|[/:_-])qwen(?:[\d._-]|$)/iu.test(model);
}

function modelName(model: string): string {
  return model.trim().toLowerCase().split("/").at(-1) || "";
}

function isNonReasoningOpenAIModel(model: string): boolean {
  return (
    /^(?:gpt-3\.5|gpt-4(?:[.o-]|$)|chatgpt-4o)(?:.*)$/u.test(model) ||
    /^gpt-5(?:\.\d+)?-chat-latest$/u.test(model)
  );
}

function isOpenAIReasoningModel(model: string): boolean {
  return (
    /^o[1-9](?:[.\d-]|$)/u.test(model) ||
    (/^gpt-[56](?:[.-]|$)/u.test(model) && !isNonReasoningOpenAIModel(model))
  );
}

function cannotDisableOpenAIReasoning(model: string): boolean {
  return (
    /^o[1-9](?:[.\d-]|$)/u.test(model) ||
    /^gpt-5(?:-(?:mini|nano|pro))?(?:-\d{4}-\d{2}-\d{2})?$/u.test(model) ||
    /^gpt-6(?:-astra|\.1-sol)(?:-|$)/u.test(model)
  );
}

// Parameter selection is deterministic. A rejected request must never be retried
// with thinking silently enabled or disabled against the user's chosen mode.
export function buildThinkingRequestOptions(
  profile: Pick<
    APIProfile,
    "endpoint" | "model" | "thinkingMode" | "thinkingParameter"
  >,
  protocol: APIProtocol,
): ThinkingRequestOptions {
  const mode = normalizeThinkingMode(profile.thinkingMode);
  const parameter = normalizeThinkingParameter(profile.thinkingParameter);
  const model = modelName(profile.model);
  const qwen = isQwenEndpoint(profile.endpoint) || isQwenModel(profile.model);
  const openAIReasoning = !qwen && isOpenAIReasoningModel(model);

  if (mode === "default") {
    return { parameters: {}, omitTemperature: openAIReasoning };
  }

  // Auto compatibility applies only to recognized OpenAI model names. An
  // explicit parameter choice remains available for gateways with model aliases.
  if (parameter === "auto" && !qwen) {
    if (isNonReasoningOpenAIModel(model)) {
      if (mode === "on") {
        throw new Error(
          `模型“${profile.model}”不支持思考模式，请选择“不思考”或“跟随服务”`,
        );
      }
      return { parameters: {}, omitTemperature: false };
    }
    if (mode === "off" && cannotDisableOpenAIReasoning(model)) {
      throw new Error(
        `模型“${profile.model}”不支持关闭思考，请选择“跟随服务”或使用支持不思考的模型`,
      );
    }
  }

  const useEnableThinking =
    parameter === "enable_thinking" ||
    (parameter === "auto" && protocol === "chat-completions" && qwen);
  const parameters: ThinkingParameters = useEnableThinking
    ? { enable_thinking: mode === "on" }
    : protocol === "responses"
      ? { reasoning: { effort: mode === "off" ? "none" : "medium" } }
      : { reasoning_effort: mode === "off" ? "none" : "medium" };

  // Qwen accepts sampling temperature in both modes. OpenAI reasoning models
  // reject it while reasoning; the original GPT-5/o models also reject it by
  // default. Omission is compatible even when a newer model allows it.
  return {
    parameters,
    omitTemperature:
      openAIReasoning &&
      (mode !== "off" || cannotDisableOpenAIReasoning(model)),
  };
}
