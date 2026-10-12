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
  thinkingMode: "off",
  thinkingParameter: "auto",
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

// The real preference renderer persists per-profile protocol and thinking
// choices; these are DOM double checks, not host UI validation.
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
const thinkingMode = doc.documentElement.querySelector(
  ".lft-api-thinking-mode",
)!;
const thinkingParameter = doc.documentElement.querySelector(
  ".lft-api-thinking-parameter",
)!;
assert.equal(thinkingMode.value, "off");
assert.deepEqual(
  thinkingMode.children.map((option) => [option.value, option.textContent]),
  [
    ["off", "不思考（更快）"],
    ["on", "思考"],
    ["default", "跟随服务"],
  ],
);
assert.equal(thinkingParameter.value, "auto");
assert.deepEqual(
  thinkingParameter.children.map((option) => option.value),
  ["auto", "reasoning", "enable_thinking"],
);
const beforeThinkingChanges = getSelectedAPIProfile();
thinkingMode.value = "on";
thinkingMode.dispatchEvent(new Event("change"));
thinkingParameter.value = "enable_thinking";
thinkingParameter.dispatchEvent(new Event("change"));
assert.deepEqual(getSelectedAPIProfile(), {
  ...beforeThinkingChanges,
  thinkingMode: "on",
  thinkingParameter: "enable_thinking",
});
thinkingMode.value = "off";
thinkingMode.dispatchEvent(new Event("change"));
assert.equal(getSelectedAPIProfile().thinkingMode, "off");
thinkingMode.value = "default";
thinkingMode.dispatchEvent(new Event("change"));
thinkingParameter.value = "reasoning";
thinkingParameter.dispatchEvent(new Event("change"));
assert.deepEqual(getSelectedAPIProfile(), {
  ...beforeThinkingChanges,
  thinkingMode: "default",
  thinkingParameter: "reasoning",
});
protocol.value = "chat-completions";
protocol.dispatchEvent(new Event("change"));
assert.equal(getSelectedAPIProfile().protocol, "chat-completions");
controller["addAPIProfile"](doc as never);
assert.equal(getSelectedAPIProfile().protocol, "responses");
assert.equal(getSelectedAPIProfile().endpoint, DEFAULT_API_BASE_URL);
assert.equal(getSelectedAPIProfile().prompt, DEFAULT_PROMPT);
assert.equal(getSelectedAPIProfile().model, "");
assert.equal(getSelectedAPIProfile().thinkingMode, "off");
assert.equal(getSelectedAPIProfile().thinkingParameter, "auto");
assert.equal(
  doc.documentElement.querySelectorAll(".lft-api-protocol").length,
  2,
);
const restoredThinkingModes = doc.documentElement.querySelectorAll(
  ".lft-api-thinking-mode",
);
const restoredThinkingParameters = doc.documentElement.querySelectorAll(
  ".lft-api-thinking-parameter",
);
assert.deepEqual(
  restoredThinkingModes.map((select) => select.value),
  ["default", "off"],
);
assert.deepEqual(
  restoredThinkingParameters.map((select) => select.value),
  ["reasoning", "auto"],
);
restoredThinkingModes[1].value = "on";
restoredThinkingModes[1].dispatchEvent(new Event("change"));
restoredThinkingParameters[1].value = "enable_thinking";
restoredThinkingParameters[1].dispatchEvent(new Event("change"));
assert.deepEqual(
  loadAPIProfiles().map(({ thinkingMode, thinkingParameter }) => ({
    thinkingMode,
    thinkingParameter,
  })),
  [
    { thinkingMode: "default", thinkingParameter: "reasoning" },
    { thinkingMode: "on", thinkingParameter: "enable_thinking" },
  ],
);

// A long-lived settings pane must retain thinking choices changed in a reader.
const firstID = loadAPIProfiles()[0].id;
function setExternalThinking(
  thinkingMode: APIProfile["thinkingMode"],
  thinkingParameter: APIProfile["thinkingParameter"],
): void {
  saveAPIProfiles(
    loadAPIProfiles().map((profile) =>
      profile.id === firstID
        ? { ...profile, thinkingMode, thinkingParameter }
        : profile,
    ),
  );
}
restoredThinkingModes[0].value = "off";
restoredThinkingModes[0].dispatchEvent(new Event("change"));
restoredThinkingParameters[0].value = "auto";
restoredThinkingParameters[0].dispatchEvent(new Event("change"));
setExternalThinking("on", "enable_thinking");
const externalProfile = loadAPIProfiles()[0];
const nameField = doc.documentElement
  .querySelectorAll(".lft-profile-field")
  .find((field) => field.children[0].textContent === "配置名称")!;
const nameInput = nameField.querySelector("input")!;
nameInput.value = "Rename after reader change";
nameInput.dispatchEvent(new Event("input"));
assert.deepEqual(loadAPIProfiles()[0], {
  ...externalProfile,
  name: nameInput.value,
});
assert.equal(restoredThinkingModes[0].value, "on");
assert.equal(restoredThinkingParameters[0].value, "enable_thinking");

// An explicit selection overrides its own field while preserving the other.
setExternalThinking("off", "reasoning");
restoredThinkingModes[0].value = "on";
restoredThinkingModes[0].dispatchEvent(new Event("change"));
assert.equal(loadAPIProfiles()[0].thinkingMode, "on");
assert.equal(loadAPIProfiles()[0].thinkingParameter, "reasoning");
setExternalThinking("off", "auto");
restoredThinkingParameters[0].value = "enable_thinking";
restoredThinkingParameters[0].dispatchEvent(new Event("change"));
assert.equal(loadAPIProfiles()[0].thinkingMode, "off");
assert.equal(loadAPIProfiles()[0].thinkingParameter, "enable_thinking");
assert.equal(restoredThinkingModes[0].value, "off");

// Adding and removing a different configuration also preserves reader changes.
setExternalThinking("on", "enable_thinking");
controller["addAPIProfile"](doc as never);
assert.equal(loadAPIProfiles()[0].thinkingMode, "on");
assert.equal(loadAPIProfiles()[0].thinkingParameter, "enable_thinking");
assert.equal(loadAPIProfiles()[2].thinkingMode, "off");
assert.equal(loadAPIProfiles()[2].thinkingParameter, "auto");
setExternalThinking("off", "reasoning");
doc.documentElement
  .querySelectorAll(".lft-api-profile")[2]
  .querySelector(".lft-icon-button")!
  .click();
assert.equal(loadAPIProfiles().length, 2);
assert.equal(loadAPIProfiles()[0].thinkingMode, "off");
assert.equal(loadAPIProfiles()[0].thinkingParameter, "reasoning");
assert.equal(
  doc.documentElement.querySelector(".lft-api-thinking-mode")!.value,
  "off",
);
assert.equal(
  doc.documentElement.querySelector(".lft-api-thinking-parameter")!.value,
  "reasoning",
);
console.log(
  "API profiles: defaults, legacy migration, selection, per-profile protocol and thinking controls passed (mock DOM)",
);
