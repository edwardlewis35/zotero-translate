import assert from "node:assert/strict";
import {
  DEFAULT_API_BASE_URL,
  inferAPIProtocol,
  resolveAPIEndpoint,
} from "../src/api-endpoint";

assert.equal(
  resolveAPIEndpoint(DEFAULT_API_BASE_URL),
  `${DEFAULT_API_BASE_URL}/responses`,
);
for (const suffix of [
  "/",
  "///",
  "/responses",
  "/responses/",
  "/chat/completions",
  "/completions/",
]) {
  assert.equal(
    resolveAPIEndpoint(`${DEFAULT_API_BASE_URL}${suffix}`),
    `${DEFAULT_API_BASE_URL}/responses`,
  );
  assert.equal(
    resolveAPIEndpoint(`${DEFAULT_API_BASE_URL}${suffix}`, "chat-completions"),
    `${DEFAULT_API_BASE_URL}/chat/completions`,
  );
}
assert.equal(
  resolveAPIEndpoint(" http://127.0.0.1:8000/v1/ "),
  "http://127.0.0.1:8000/v1/responses",
);
assert.equal(
  resolveAPIEndpoint(
    "https://example.com/gateway/v1/chat/completions/?api-version=2026#doc",
  ),
  "https://example.com/gateway/v1/responses?api-version=2026",
);
assert.equal(
  resolveAPIEndpoint("https://example.com"),
  "https://example.com/responses",
);
assert.equal(
  inferAPIProtocol("https://example.com/v1/chat/completions/?x=1"),
  "chat-completions",
);
assert.equal(
  inferAPIProtocol("https://example.com/v1/completions"),
  "chat-completions",
);
assert.equal(inferAPIProtocol(DEFAULT_API_BASE_URL), "responses");
assert.equal(
  inferAPIProtocol(`${DEFAULT_API_BASE_URL}/responses`),
  "responses",
);
for (const invalid of [
  "",
  "example.com/v1",
  "ftp://example.com/v1",
  "file:///v1",
]) {
  assert.throws(() => resolveAPIEndpoint(invalid), /Base URL/u);
}
console.log(
  "API endpoints: Base URL, existing suffixes, protocol switches, prefix/query preservation and validation passed",
);
