import assert from "node:assert/strict";
import { DEFAULT_API_BASE_URL } from "../src/api-endpoint";
import {
  DEFAULT_PROMPT,
  getSelectedAPIProfile,
  loadAPIProfiles,
  saveAPIProfiles,
  selectAPIProfile,
  type APIProfile,
} from "../src/prefs";
import { PreferencesController } from "../src/preferences";
import { TestDocument } from "./helpers/dom";

const prefs = new Map<string, unknown>();
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
  },
});

const fresh = getSelectedAPIProfile();
assert.equal(fresh.endpoint, DEFAULT_API_BASE_URL);
assert.equal(fresh.protocol, "responses");
assert.equal(fresh.model, "");
const legacy: APIProfile = {
  id: "custom",
  name: "Existing service",
  endpoint: "https://example.com/gateway/v1/chat/completions/?version=1",
  apiKey: "mock-key",
  model: "existing-model",
  temperature: "0.7",
  targetLanguage: "English",
  prompt: "Custom ${sourceText}",
};
prefs.set(
  "apiProfiles",
  JSON.stringify([
    legacy,
    { ...legacy, id: "base", endpoint: DEFAULT_API_BASE_URL },
  ]),
);
prefs.set("selectedApiProfileId", "custom");
assert.deepEqual(getSelectedAPIProfile(), {
  ...legacy,
  protocol: "chat-completions",
});
assert.equal(loadAPIProfiles()[1].protocol, "responses");
const migrated = saveAPIProfiles(loadAPIProfiles());
assert.equal(prefs.get("selectedApiProfileId"), "custom");
assert.deepEqual(JSON.parse(prefs.get("apiProfiles") as string), migrated);
selectAPIProfile("base");
assert.equal(getSelectedAPIProfile().id, "base");
selectAPIProfile("missing");
assert.equal(getSelectedAPIProfile().id, "base");
saveAPIProfiles([{ ...legacy, protocol: "responses" }]);
assert.equal(getSelectedAPIProfile().protocol, "responses");
assert.equal(getSelectedAPIProfile().endpoint, legacy.endpoint);
assert.equal(prefs.get("selectedApiProfileId"), "custom");

// Pre-0.3.0 individual preferences also retain their URL, key and model.
prefs.clear();
prefs.set("openaiEndpoint", legacy.endpoint);
prefs.set("openaiApiKey", legacy.apiKey);
prefs.set("openaiModel", legacy.model);
assert.equal(getSelectedAPIProfile().protocol, "chat-completions");
assert.equal(getSelectedAPIProfile().apiKey, legacy.apiKey);
assert.equal(getSelectedAPIProfile().model, legacy.model);

// Legacy settings that relied on the former URL default must keep their key
// with OpenAI even though the installed addon now has a Qwen default URL.
prefs.clear();
prefs.set("openaiApiKey", legacy.apiKey);
assert.equal(
  getSelectedAPIProfile().endpoint,
  "https://api.openai.com/v1/chat/completions",
);
assert.equal(getSelectedAPIProfile().protocol, "chat-completions");
assert.equal(getSelectedAPIProfile().model, "gpt-4o-mini");
Object.assign(globalThis, {
  Services: { prefs: { prefHasUserValue: () => true } },
});
prefs.set("openaiEndpoint", DEFAULT_API_BASE_URL);
assert.equal(getSelectedAPIProfile().endpoint, DEFAULT_API_BASE_URL);
assert.equal(getSelectedAPIProfile().protocol, "responses");
Reflect.deleteProperty(globalThis, "Services");

// The real preference renderer persists protocol changes and defaults new
// cards to Responses; these are DOM double checks, not host UI validation.
prefs.clear();
const doc = new TestDocument();
for (const id of ["lft-api-profile-list", "lft-settings-status"]) {
  const element = doc.createElement("div");
  element.id = id;
  doc.documentElement.append(element);
}
const controller = new PreferencesController({} as never);
controller["apiProfiles"] = saveAPIProfiles(loadAPIProfiles());
controller["renderAPIProfiles"](doc as never);
const protocol = doc.documentElement.querySelector(".lft-api-protocol")!;
assert.equal(protocol.value, "responses");
protocol.value = "chat-completions";
protocol.dispatchEvent(new Event("change"));
assert.equal(getSelectedAPIProfile().protocol, "chat-completions");
controller["addAPIProfile"](doc as never);
assert.equal(getSelectedAPIProfile().protocol, "responses");
assert.equal(getSelectedAPIProfile().endpoint, DEFAULT_API_BASE_URL);
assert.equal(getSelectedAPIProfile().prompt, DEFAULT_PROMPT);
assert.equal(getSelectedAPIProfile().model, "");
assert.equal(
  doc.documentElement.querySelectorAll(".lft-api-protocol").length,
  2,
);
console.log(
  "API profiles: defaults, legacy migration, selection, protocol persistence and new profile UI passed (mock DOM)",
);
