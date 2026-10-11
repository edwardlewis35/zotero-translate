export type APIProtocol = "responses" | "chat-completions";

export const DEFAULT_API_BASE_URL =
  "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1";

// Old profiles stored a complete Chat Completions endpoint. Preserve their
// protocol while new Base URL profiles default to Responses.
export function inferAPIProtocol(endpoint: string): APIProtocol {
  try {
    return /\/(?:chat\/)?completions\/*$/iu.test(new URL(endpoint).pathname)
      ? "chat-completions"
      : "responses";
  } catch {
    return "responses";
  }
}

export function resolveAPIEndpoint(
  value: string,
  protocol: APIProtocol = "responses",
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请填写有效的 API Base URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API Base URL 必须使用 HTTP 或 HTTPS");
  }
  const basePath = url.pathname
    .replace(/\/+$/u, "")
    .replace(/\/(?:responses|chat\/completions|completions)$/iu, "");
  url.pathname = `${basePath}/${protocol === "chat-completions" ? "chat/completions" : "responses"}`;
  url.hash = "";
  return url.href;
}
