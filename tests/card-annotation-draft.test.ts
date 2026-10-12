import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { TranslationCard } from "../src/ui/card";
import type { LocalLookupResult } from "../src/dictionary/types";

const profile = {
  id: "mock",
  name: "Mock",
  model: "mock-model",
  endpoint: "https://example.invalid/v1",
  protocol: "responses",
  apiKey: "",
  prompt: "Explain ${sourceText}",
  targetLanguage: "简体中文",
  temperature: "0.2",
};
const prefs = new Map<string, unknown>([
  ["apiProfiles", JSON.stringify([profile])],
  ["selectedApiProfileId", "mock"],
]);
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    HTTP: {
      request: async () => ({
        status: 200,
        responseText: JSON.stringify({
          status: "completed",
          output_text:
            "## sample\n### 释义\nA sample is an example.\n一个示例。",
        }),
      }),
    },
    Utilities: { Internal: { copyTextToClipboard() {} } },
    logError() {},
  },
});

function result(word = "sample"): LocalLookupResult {
  return {
    word,
    configuredDictionaries: 1,
    errors: [],
    entries: [
      {
        headword: word,
        source: "Invented",
        pronunciations: [],
        audio: [],
        forms: [],
        tags: [],
        senses: [
          {
            partOfSpeech: "n.",
            translation: "示例",
            lines: [],
            chinese: "示例",
            definition: `A ${word} is an example.`,
            examples: [
              { text: `Here is a ${word}.`, translation: "这里是一个示例。" },
            ],
          },
        ],
      },
    ],
  };
}

function mount(isWord = true) {
  const { document, window } = parseHTML(
    "<html><head></head><body></body></html>",
  );
  const saved: string[] = [];
  let selection: Selection | null = null;
  Object.defineProperty(document, "getSelection", { value: () => selection });
  let current = result();
  let saveHandler: (text: string) => Promise<void> = async (text) => {
    saved.push(text);
  };
  const card = new TranslationCard(
    document as unknown as Document,
    isWord ? "sample" : "This is a paragraph.",
    isWord,
    { lookup: async () => current } as never,
    () => {},
    (text) => saveHandler(text),
  );
  document.body.append(card.root);
  const root = card.root;
  const button = () =>
    root.querySelector<HTMLButtonElement>(".lft-button-annotation")!;
  const input = () =>
    root.querySelector<HTMLTextAreaElement>(".lft-annotation-draft-input")!;
  const event = (type: string) => new window.Event(type, { bubbles: true });
  const edit = (text: string) => {
    input().value = text;
    input().dispatchEvent(event("input"));
  };
  const pick = (
    target: Element,
    text: string,
    end: Node = target.firstChild!,
  ) => {
    selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: target.firstChild!,
        endContainer: end,
      }),
      toString: () => text,
    } as unknown as Selection;
    target.dispatchEvent(event("pointerup"));
    target.dispatchEvent(event("mouseup"));
  };
  return {
    card,
    root,
    document,
    saved,
    button,
    input,
    edit,
    pick,
    event,
    setResult(value: LocalLookupResult) {
      current = value;
    },
    setSave(handler: typeof saveHandler) {
      saveHandler = handler;
    },
  };
}
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const selected = mount();
await selected.card.lookupLocal();
const definition = selected.root.querySelector(".lft-definition-original")!;
const example = selected.root.querySelector(".lft-example-original")!;
selected.pick(definition, "A sample is an example.");
selected.pick(example, "Here is a sample.");
assert.equal(
  selected.input().value,
  "A sample is an example.\n\nHere is a sample.",
);
assert.equal(
  selected.root.querySelector<HTMLDetailsElement>(".lft-annotation-draft")!
    .open,
  true,
);
selected.pick(example, "Here is a sample.");
assert.equal(
  selected.input().value,
  "A sample is an example.\n\nHere is a sample.",
);
// Selections crossing into the toolbar or originating from the editor stay out.
selected.pick(
  definition,
  "unrelated toolbar",
  selected.root.querySelector(".lft-model-picker")!,
);
assert.ok(!selected.input().value.includes("unrelated"));
selected.button().click();
await settled();
assert.deepEqual(selected.saved, [
  "A sample is an example.\n\nHere is a sample.",
]);
assert.equal(selected.button().disabled, true);
selected.button().click();
assert.equal(selected.saved.length, 1);

selected.edit("手动说明\n<svg onload=alert(1)>literal</svg>");
assert.equal(selected.root.querySelector("svg"), null);
assert.equal(selected.button().disabled, false);
selected.button().click();
await settled();
assert.equal(selected.saved[1], "手动说明\n<svg onload=alert(1)>literal</svg>");
selected.edit("");
selected.input().dispatchEvent(selected.event("keyup"));
assert.equal(
  selected.input().value,
  "",
  "typing in the editor must not recapture an old body selection",
);
assert.equal(
  selected.button().disabled,
  true,
  "an empty explicit draft must not save the full translation",
);
selected.root
  .querySelector<HTMLButtonElement>(".lft-button-full-annotation")!
  .click();
assert.equal(selected.button().disabled, false);
selected.button().click();
await settled();
assert.equal(selected.saved[2], "sample · Invented\nn. 示例");

selected.edit("Keep this custom note");
await selected.card.translateOnline();
assert.equal(
  selected.input().value,
  "Keep this custom note",
  "same-word source switches preserve manual edits",
);
selected.setResult(result("bank"));
await selected.card.lookupLocal();
assert.equal(
  selected.input().value,
  "",
  "a different query must not reuse the previous word's draft",
);

const pending = mount();
await pending.card.lookupLocal();
let release!: () => void;
pending.setSave(async (text) => {
  pending.saved.push(text);
  await new Promise<void>((resolve) => {
    release = resolve;
  });
});
pending.edit("first content");
pending.button().click();
assert.equal(pending.button().disabled, true);
pending.edit("second content");
assert.equal(
  pending.button().disabled,
  true,
  "edits must not enable a concurrent second save",
);
release();
await settled();
assert.deepEqual(pending.saved, ["first content"]);
assert.equal(
  pending.button().disabled,
  false,
  "an earlier save must not mark a newer edit as saved",
);
assert.equal(pending.root.querySelector(".lft-annotation-status"), null);

const paragraph = mount(false);
await paragraph.card.translateOnline();
assert.equal(paragraph.root.querySelector(".lft-annotation-draft"), null);
paragraph.button().click();
await settled();
assert.equal(
  paragraph.saved[0],
  "## sample\n### 释义\nA sample is an example.\n一个示例。",
);
console.log(
  "Card annotation drafts: multi-pick dedupe, exact custom saving, safe text, explicit empty, source/query changes, pending edit races and unchanged paragraph save passed (mock Selection)",
);
