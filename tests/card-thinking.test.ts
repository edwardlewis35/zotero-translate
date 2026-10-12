import assert from "node:assert/strict";
import { TranslationCard } from "../src/ui/card";
import {
  getSelectedAPIProfile,
  loadAPIProfiles,
  type APIProfile,
} from "../src/prefs";
import type { LocalLookupResult } from "../src/dictionary/types";
import { TestDocument, TestElement } from "./helpers/dom";

const first: APIProfile = {
  id: "first",
  name: "First model",
  endpoint: "https://example.invalid/v1",
  protocol: "responses",
  apiKey: "",
  model: "custom-model",
  temperature: "0.2",
  targetLanguage: "简体中文",
  prompt: "Explain ${sourceText}",
};
const second: APIProfile = {
  ...first,
  id: "second",
  model: "second-model",
  thinkingMode: "on",
  thinkingParameter: "enable_thinking",
};
const prefs = new Map<string, unknown>([
  ["apiProfiles", JSON.stringify([first, second])],
  ["selectedApiProfileId", first.id],
]);
const requests: Record<string, unknown>[] = [];
type Response = { status: number; responseText: string };
type Options = {
  body: string;
  cancellerReceiver: (cancel: () => void) => void;
};
const complete: Response = {
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text: "完整词典解释与例句。",
  }),
};
let respond = async (_options: Options): Promise<Response> => complete;
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    HTTP: {
      request: (_method: string, _url: string, options: Options) => {
        requests.push(JSON.parse(options.body));
        return respond(options);
      },
    },
  },
});
const miss = (): LocalLookupResult => ({
  word: "studies",
  configuredDictionaries: 1,
  errors: [],
  entries: [],
});
function mount(lookup = async () => miss(), isWord = true) {
  const doc = new TestDocument();
  const card = new TranslationCard(
    doc as never,
    isWord ? "studies" : "A sentence.",
    isWord,
    { lookup } as never,
    () => {},
  );
  const root = card.root as unknown as TestElement;
  doc.documentElement.append(root);
  return { card, root };
}
function change(element: TestElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event("change"));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Legacy profiles default to fast/no-thinking without losing their settings.
const initial = mount();
await initial.card.lookupLocal(false);
assert.equal(initial.root.querySelector(".lft-thinking-select")!.value, "off");
assert.equal(requests.length, 0);
change(initial.root.querySelector(".lft-thinking-select")!, "on");
assert.equal(getSelectedAPIProfile().thinkingMode, "on");
assert.equal(getSelectedAPIProfile().prompt, first.prompt);
assert.equal(getSelectedAPIProfile().endpoint, first.endpoint);
assert.equal(loadAPIProfiles()[1]!.thinkingParameter, "enable_thinking");
assert.equal(
  requests.length,
  0,
  "A setting change alone never generates a billable request",
);
await initial.card.translateOnline();
assert.deepEqual(requests.at(-1)!.reasoning, { effort: "medium" });

// Profile switching restores that model's saved mode and selected adapter.
change(initial.root.querySelector(".lft-model-select")!, second.id);
assert.equal(initial.root.querySelector(".lft-thinking-select")!.value, "on");
change(initial.root.querySelector(".lft-thinking-select")!, "off");
assert.equal(getSelectedAPIProfile().thinkingMode, "off");
await initial.card.translateOnline();
assert.equal(requests.at(-1)!.enable_thinking, false);
assert.ok(!("reasoning" in requests.at(-1)!));
change(initial.root.querySelector(".lft-model-select")!, first.id);
assert.equal(initial.root.querySelector(".lft-thinking-select")!.value, "on");
const reopened = mount();
await reopened.card.lookupLocal(false);
assert.equal(reopened.root.querySelector(".lft-thinking-select")!.value, "on");

// Follow-service intentionally omits overrides and does not invent fast mode.
change(reopened.root.querySelector(".lft-thinking-select")!, "default");
await reopened.card.translateOnline();
for (const key of ["reasoning", "reasoning_effort", "enable_thinking"])
  assert.ok(!(key in requests.at(-1)!));
assert.equal(getSelectedAPIProfile().thinkingMode, "default");

// The choice made while dictionaries load controls the automatic miss request.
const local = deferred<LocalLookupResult>();
const pending = mount(async () => local.promise);
const lookup = pending.card.lookupLocal();
assert.equal(
  pending.root.querySelector(".lft-thinking-select")!.disabled,
  false,
);
change(pending.root.querySelector(".lft-thinking-select")!, "off");
local.resolve(miss());
await lookup;
assert.deepEqual(requests.at(-1)!.reasoning, { effort: "none" });

// Streaming locks the picker for this request; completion unlocks it without
// changing the mode. Paragraphs use the same model setting.
const network = deferred<Response>();
respond = async () => network.promise;
const paragraph = mount(undefined, false);
const translating = paragraph.card.translateOnline();
assert.equal(
  paragraph.root.querySelector(".lft-thinking-select")!.disabled,
  true,
);
assert.equal(paragraph.root.querySelector(".lft-model-select")!.disabled, true);
assert.deepEqual(requests.at(-1)!.reasoning, { effort: "none" });
network.resolve(complete);
await translating;
assert.equal(
  paragraph.root.querySelector(".lft-thinking-select")!.disabled,
  false,
);
assert.equal(
  paragraph.root.querySelector(".lft-thinking-select")!.value,
  "off",
);

// Invalid stored values use off/auto without discarding custom prompt or key.
prefs.set(
  "apiProfiles",
  JSON.stringify([
    { ...first, thinkingMode: "invalid", thinkingParameter: "invalid" },
  ]),
);
const normalized = getSelectedAPIProfile();
assert.equal(normalized.thinkingMode, "off");
assert.equal(normalized.thinkingParameter, "auto");
assert.equal(normalized.prompt, first.prompt);
await flush();
console.log(
  "Thinking card: no-request manual choice, independent profiles, persistence, automatic fallback, stream locking and paragraph mode passed",
);
