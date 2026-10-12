import assert from "node:assert/strict";
import { TranslationCard } from "../src/ui/card";
import type {
  DictionaryEntry,
  DictionarySense,
  LocalLookupOptions,
  LocalLookupResult,
} from "../src/dictionary/types";
import { TestDocument, TestElement } from "./helpers/dom";

const prefs = new Map<string, unknown>([["loadDictionaryAudio", false]]);
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    logError: () => {},
  },
});

// These invented entries verify the presentation contract without shipping
// text copied from a user's licensed dictionary.
function entry(source: string, senses: DictionarySense[]): DictionaryEntry {
  return {
    source,
    headword: "sample",
    pronunciations: [
      { region: "英", text: "/ˈsɑːmpəl/" },
      { region: "美", text: "/ˈsæmpəl/" },
    ],
    forms: [{ label: "复数", value: "samples" }],
    tags: ["常用词"],
    audio: [],
    senses,
  };
}

const structured: DictionarySense = {
  partOfSpeech: "n.",
  number: "1",
  chinese: "示范释义",
  definition: "An invented definition for a display test.",
  labels: ["可数"],
  heading: "sample phrase",
  examples: [
    {
      text: "Here is an invented example.",
      translation: "这里是虚构例句。",
    },
  ],
  notes: [{ text: "A usage detail.", translation: "这是用法提示。" }],
  translation: "完整批注释义和例句",
  lines: [
    { text: "示范释义", kind: "definition" },
    { text: "An invented definition for a display test.", kind: "definition" },
    { text: "Here is an invented example.", kind: "example" },
    { text: "这里是虚构例句。", kind: "translation" },
    { text: "A usage detail.", kind: "mixed" },
    { text: "这是用法提示。", kind: "translation" },
  ],
};
const fallback: DictionarySense = {
  partOfSpeech: "v.",
  translation: "兼容旧结构",
  lines: [
    { text: "兼容旧结构", kind: "definition" },
    { text: "A fallback example.", kind: "example" },
    { text: "旧格式例句译文。", kind: "translation" },
    { text: "<script>literal text</script>", kind: "mixed" },
  ],
};

function mount(
  lookup: (
    word: string,
    options?: LocalLookupOptions,
  ) => Promise<LocalLookupResult>,
  selection = "sample",
) {
  const doc = new TestDocument();
  const saved: string[] = [];
  const played: string[] = [];
  const createElement = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => {
    const element = createElement(tag);
    if (tag === "audio")
      Object.assign(element, {
        src: "",
        play: async () =>
          played.push((element as TestElement & { src: string }).src),
      });
    return element;
  };
  const instance = new TranslationCard(
    doc as never,
    selection,
    true,
    { lookup } as never,
    () => {},
    async (text) => {
      saved.push(text);
    },
  );
  const root = instance.root as unknown as TestElement;
  doc.documentElement.append(root);
  return { instance, root, saved, played };
}

const result: LocalLookupResult = {
  word: "sample",
  entries: [
    entry("示例甲词典", [structured]),
    {
      ...entry("示例乙词典", [fallback]),
      headword: "sample-alt",
      pronunciations: [{ region: "美", text: "/ˈsæmpəl ɔːlt/" }],
    },
  ],
  errors: [],
  configuredDictionaries: 2,
};
const display = mount(async () => result);
await display.instance.lookupLocal();
const panels = display.root.querySelectorAll(".lft-dictionary");
const tabs = display.root.querySelectorAll(".lft-dictionary-tab");
const sharedHeader = display.root.querySelector(".lft-entry-header")!;
const localContent = display.root.querySelector(".lft-local-result")!;
assert.ok(
  localContent.children.indexOf(sharedHeader) <
    localContent.children.indexOf(
      display.root.querySelector(".lft-dictionary-tabs")!,
    ),
  "the selected headword and its pronunciation precede the source tabs",
);
assert.equal(
  display.root.querySelectorAll(".lft-dictionary-headword").length,
  1,
);
assert.equal(panels.length, 2);
assert.deepEqual(
  panels.map((panel) => panel.hidden),
  [false, true],
);
assert.equal(tabs[0]!.getAttribute("aria-selected"), "true");
assert.equal(tabs[1]!.getAttribute("aria-selected"), "false");
assert.equal(panels[0]!.getAttribute("aria-labelledby"), tabs[0]!.id);
assert.equal(tabs[0]!.getAttribute("aria-controls"), panels[0]!.id);

const first = panels[0]!;
const content = first.querySelector(".lft-sense-content")!;
const main = content.querySelector(".lft-definition-translation")!;
const original = content.querySelector(".lft-definition-original")!;
assert.ok(content.children.indexOf(main) < content.children.indexOf(original));
assert.equal(first.querySelectorAll(".lft-example").length, 1);
assert.equal(first.querySelectorAll(".lft-example-original").length, 1);
assert.equal(
  first.querySelector(".lft-example-translation")!.textContent,
  "这里是虚构例句。",
);
assert.equal(first.querySelector(".lft-sense-label")!.textContent, "可数");
assert.equal(
  first.querySelector(".lft-sense-heading")!.textContent,
  "sample phrase",
);
assert.equal(
  first.textContent.split("示范释义").length - 1,
  1,
  "structured fields must not repeat the legacy lines",
);
assert.equal(first.querySelector(".lft-sense-number")!.textContent, "1");
assert.equal(first.querySelector(".lft-dictionary-header"), null);
assert.equal(sharedHeader.querySelectorAll(".lft-pronunciation").length, 2);
assert.equal(
  sharedHeader.querySelector(".lft-dictionary-headword")!.textContent,
  "sample",
);
assert.deepEqual(
  first.querySelectorAll("details").map((group) => group.open),
  [true, true, true],
  "meanings, tags and forms start expanded",
);
assert.deepEqual(
  first.querySelectorAll("summary").map((summary) => summary.textContent),
  ["双语释义", "词条标签", "词形变化"],
);
assert.equal(first.querySelector(".lft-audio"), null);
assert.equal(
  first.querySelector(".lft-usage-note-translation")!.textContent,
  "这是用法提示。",
);
assert.equal(first.textContent.split("这是用法提示。").length - 1, 1);

tabs[1]!.click();
assert.deepEqual(
  panels.map((panel) => panel.hidden),
  [true, false],
);
assert.equal(tabs[1]!.getAttribute("aria-selected"), "true");
assert.equal(
  sharedHeader.querySelector(".lft-dictionary-headword")!.textContent,
  "sample-alt",
);
assert.deepEqual(
  sharedHeader
    .querySelectorAll(".lft-pron-text")
    .map((pronunciation) => pronunciation.textContent),
  ["/ˈsæmpəl ɔːlt/"],
  "switching source must replace the headword and IPA rather than combine dictionaries",
);
assert.equal(
  panels[1]!.querySelector(".lft-example")!.textContent,
  "A fallback example.旧格式例句译文。",
);
assert.ok(panels[1]!.textContent.includes("<script>literal text</script>"));
assert.equal(panels[1]!.querySelector("script"), null);
const home = new Event("keydown", { cancelable: true });
Object.assign(home, { key: "Home" });
tabs[1]!.dispatchEvent(home);
assert.deepEqual(
  panels.map((panel) => panel.hidden),
  [false, true],
);
assert.equal(
  sharedHeader.querySelector(".lft-dictionary-headword")!.textContent,
  "sample",
);
assert.deepEqual(
  sharedHeader
    .querySelectorAll(".lft-pron-text")
    .map((pronunciation) => pronunciation.textContent),
  ["/ˈsɑːmpəl/", "/ˈsæmpəl/"],
);

display.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "写入批注")!
  .click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(display.saved[0]!.includes("示例甲词典"));
assert.ok(display.saved[0]!.includes("示例乙词典"));
assert.ok(display.saved[0]!.includes("旧格式例句译文。"));
assert.ok(display.saved[0]!.includes("这是用法提示。"));

// Highlight the query and actual dictionary forms in semantic body text. The
// rendered marks must preserve the original case/text and canonical annotation.
const highlightedSense: DictionarySense = {
  number: "1",
  partOfSpeech: "n.",
  heading: "BANK usage: banker",
  chinese: "这里的 BANK 指虚构释义。",
  definition:
    "A bank banks funds; a banker passed <img src=x onerror=alert(1)>.",
  examples: [
    {
      text: "She banked a coin beside river bank.",
      translation: "她在 bank 旁放了一枚虚构硬币。",
    },
  ],
  notes: [
    {
      text: "BANKING is an invented form here; banker stays unchanged.",
      translation: "这里只高亮 bank 和真实词形。",
    },
  ],
  translation: "虚构的完整释义。",
  lines: [],
};
highlightedSense.lines = [
  { text: highlightedSense.chinese!, kind: "definition" },
  { text: highlightedSense.definition!, kind: "definition" },
  { text: highlightedSense.examples![0]!.text, kind: "example" },
  { text: highlightedSense.examples![0]!.translation!, kind: "translation" },
  { text: highlightedSense.notes![0]!.text!, kind: "mixed" },
  { text: highlightedSense.notes![0]!.translation!, kind: "translation" },
];
const highlightedFallback: DictionarySense = {
  number: "2",
  partOfSpeech: "v.",
  translation: "虚构的旧格式释义。",
  lines: [
    { text: "<script>bank</script> and banker.", kind: "mixed" },
    { text: "A BANK fallback.", kind: "example" },
    { text: "这是 bank 的旧格式例句。", kind: "translation" },
  ],
};
const highlightedEntry: DictionaryEntry = {
  ...entry("bank 演示词典", [highlightedSense, highlightedFallback]),
  headword: "Bank",
  pronunciations: [],
  forms: [
    { label: "复数", value: "banks" },
    { label: "过去式", value: "banked" },
    { label: "现在分词", value: "banking" },
    { label: "短语", value: "river bank" },
  ],
  tags: ["bank"],
};
const highlighted = mount(
  async () => ({
    word: "bank",
    configuredDictionaries: 1,
    errors: [],
    entries: [highlightedEntry],
  }),
  "bank",
);
await highlighted.instance.lookupLocal();
const highlightedBody = highlighted.root.querySelector(".lft-dictionary")!;
const highlightedFirstSense = highlightedBody.querySelector(".lft-sense")!;
const semanticHighlights: [string, string, string[]][] = [
  [".lft-sense-heading", highlightedSense.heading!, ["BANK"]],
  [".lft-definition-translation", highlightedSense.chinese!, ["BANK"]],
  [".lft-definition-original", highlightedSense.definition!, ["bank", "banks"]],
  [
    ".lft-example-original",
    highlightedSense.examples![0]!.text,
    ["banked", "bank"],
  ],
  [
    ".lft-example-translation",
    highlightedSense.examples![0]!.translation!,
    ["bank"],
  ],
  [".lft-usage-note-original", highlightedSense.notes![0]!.text!, ["BANKING"]],
  [
    ".lft-usage-note-translation",
    highlightedSense.notes![0]!.translation!,
    ["bank"],
  ],
];
for (const [selector, text, matches] of semanticHighlights) {
  const node = highlightedFirstSense.querySelector(selector)!;
  assert.equal(node.textContent, text, `${selector} keeps its original text`);
  assert.deepEqual(
    node.querySelectorAll(".lft-query-word").map((mark) => mark.textContent),
    matches,
    `${selector} highlights only whole query words and real forms`,
  );
}
assert.deepEqual(
  highlightedBody.querySelectorAll(".lft-form-value").map((form) => ({
    text: form.textContent,
    matches: form
      .querySelectorAll(".lft-query-word")
      .map((mark) => mark.textContent),
  })),
  [
    { text: "banks", matches: ["banks"] },
    { text: "banked", matches: ["banked"] },
    { text: "banking", matches: ["banking"] },
    { text: "river bank", matches: ["bank"] },
  ],
  "a multiword form does not turn the unrelated word river into a match",
);
const highlightedLegacySense =
  highlightedBody.querySelectorAll(".lft-sense")[1]!;
assert.equal(
  highlightedLegacySense.querySelector(".lft-sense-line")!.textContent,
  highlightedFallback.lines[0]!.text,
);
assert.deepEqual(
  highlightedLegacySense
    .querySelectorAll(".lft-query-word")
    .map((mark) => mark.textContent),
  ["bank", "BANK", "bank"],
);
const dictionaryMarks = highlightedBody.querySelectorAll(".lft-query-word");
assert.ok(dictionaryMarks.length > 0);
assert.ok(dictionaryMarks.every((mark) => mark.tagName === "mark"));
assert.ok(
  dictionaryMarks.every(
    (mark) => !["banker", "river"].includes(mark.textContent),
  ),
);
assert.equal(highlightedBody.querySelector("img"), null);
assert.equal(highlightedBody.querySelector("script"), null);
for (const selector of [
  ".lft-card-header",
  ".lft-entry-header",
  ".lft-dictionary-tabs",
  ".lft-source",
  ".lft-tag",
])
  assert.equal(
    highlighted.root.querySelector(selector)!.querySelector(".lft-query-word"),
    null,
  );
highlighted.root.querySelector(".lft-button-annotation")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  highlighted.saved[0],
  [
    "Bank · bank 演示词典",
    `1 n. ${highlightedSense.lines.map((line) => line.text).join("\n")}`,
    `2 v. ${highlightedFallback.lines.map((line) => line.text).join("\n")}`,
  ].join("\n"),
  "annotation uses original canonical text, including literal HTML, without rendered marks",
);
assert.ok(!highlighted.saved[0]!.includes("<mark"));
assert.ok(!highlighted.saved[0]!.includes("lft-query-word"));

// A user can read every sense of a long entry. Expansion and the active source
// survive the redraw when the remaining dictionary lookup finishes.
const longEntry = entry(
  "长词条示例词典",
  Array.from({ length: 9 }, (_, index) => ({
    ...structured,
    number: String(index + 1),
    chinese: `示范义项 ${index + 1}`,
    partOfSpeech: index < 6 ? "n." : "v.",
  })),
);
const partial = { ...result, entries: [result.entries[0]!, longEntry] };
let finish!: (value: LocalLookupResult) => void;
const waiting = new Promise<LocalLookupResult>((resolve) => {
  finish = resolve;
});
const progressive = mount(async (_word, options) => {
  options?.onProgress?.({
    result: partial,
    completed: 2,
    total: 3,
    message: "等待第三部词典",
  });
  return waiting;
});
const query = progressive.instance.lookupLocal();
progressive.root.querySelectorAll(".lft-dictionary-tab")[1]!.click();
let longPanel = progressive.root.querySelectorAll(".lft-dictionary")[1]!;
assert.equal(
  longPanel.querySelectorAll(".lft-sense").filter((sense) => !sense.hidden)
    .length,
  6,
);
assert.equal(longPanel.querySelectorAll(".lft-pos-heading")[1]!.hidden, true);
longPanel.querySelector(".lft-sense-expand-button")!.click();
assert.ok(
  longPanel.querySelectorAll(".lft-sense").every((sense) => !sense.hidden),
);
assert.equal(longPanel.querySelectorAll(".lft-pos-heading")[1]!.hidden, false);
const formsSection = longPanel.querySelectorAll("details")[2]!;
formsSection.open = false;
formsSection.dispatchEvent(new Event("toggle"));
finish({
  ...partial,
  entries: [...partial.entries, entry("示例丙词典", [fallback])],
});
await query;
const finalPanels = progressive.root.querySelectorAll(".lft-dictionary");
assert.deepEqual(
  finalPanels.map((panel) => panel.hidden),
  [true, false, true],
);
longPanel = finalPanels[1]!;
assert.deepEqual(
  longPanel.querySelectorAll("details").map((group) => group.open),
  [true, true, false],
  "only the section closed by the user stays collapsed when more dictionaries finish",
);
assert.ok(
  finalPanels[2]!.querySelectorAll("details").every((group) => group.open),
);
assert.ok(
  longPanel.querySelectorAll(".lft-sense").every((sense) => !sense.hidden),
);
longPanel.querySelector(".lft-sense-expand-button")!.click();
assert.equal(
  longPanel.querySelectorAll(".lft-sense").filter((sense) => !sense.hidden)
    .length,
  6,
);

// Native details toggle is queued. Snapshot the live open property before a
// progressive redraw even if the queued toggle has not been delivered yet.
let finishEarlyToggle!: (value: LocalLookupResult) => void;
const earlyToggleResult = new Promise<LocalLookupResult>((resolve) => {
  finishEarlyToggle = resolve;
});
const earlyToggle = mount(async (_word, options) => {
  options?.onProgress?.({
    result: partial,
    completed: 2,
    total: 3,
    message: "仍在查词",
  });
  return earlyToggleResult;
});
const earlyQuery = earlyToggle.instance.lookupLocal();
const detachedSection = earlyToggle.root
  .querySelectorAll(".lft-dictionary")[0]!
  .querySelector("details")!;
detachedSection.open = false; // No toggle event yet.
finishEarlyToggle({
  ...partial,
  entries: [...partial.entries, entry("最后一部词典", [fallback])],
});
await earlyQuery;
const preservedSection = earlyToggle.root
  .querySelectorAll(".lft-dictionary")[0]!
  .querySelector("details")!;
assert.equal(preservedSection.open, false);
detachedSection.open = true;
detachedSection.dispatchEvent(new Event("toggle"));
assert.equal(
  preservedSection.open,
  false,
  "a detached section's stale toggle cannot overwrite current state",
);
assert.equal(
  earlyToggle.root
    .querySelectorAll(".lft-dictionary")[2]!
    .querySelector("details")!.open,
  true,
);

// Several pronunciations may share a region. A known MDD resource key must
// never borrow a different recording when its own resource is unavailable.
prefs.set("loadDictionaryAudio", true);
const audioLoads: string[] = [];
const preciseAudioEntry: DictionaryEntry = {
  ...entry("准确发音映射示例", [structured]),
  pronunciations: [
    { region: "英", text: "/ˈluːmən/", resource: "first.mp3" },
    { region: "英", text: "/luːˈmən/", resource: "second.mp3" },
    { region: "英", text: "/ˈlʊmən/", resource: "missing.mp3" },
  ],
  // Reverse asset order so index/region fallback cannot accidentally pass.
  audio: ["second.mp3", "first.mp3"].map((resource) => ({
    resource,
    region: "英",
    label: resource,
    load: async () => {
      audioLoads.push(resource);
      return `mock:${resource}`;
    },
  })),
};
const preciseAudio = mount(async () => ({
  ...result,
  entries: [preciseAudioEntry],
  configuredDictionaries: 1,
}));
await preciseAudio.instance.lookupLocal();
const singleSourceTab = preciseAudio.root.querySelectorAll(
  ".lft-dictionary-tab",
);
assert.equal(
  singleSourceTab.length,
  1,
  "a sole dictionary still identifies the selected source",
);
assert.equal(singleSourceTab[0]!.getAttribute("role"), "tab");
assert.equal(singleSourceTab[0]!.getAttribute("aria-selected"), "true");
assert.equal(singleSourceTab[0]!.textContent, "准确发音映射示例");
const precisePronunciations =
  preciseAudio.root.querySelectorAll(".lft-pronunciation");
assert.equal(precisePronunciations.length, 3);
assert.equal(preciseAudio.root.querySelectorAll(".lft-audio").length, 2);
assert.equal(precisePronunciations[2]!.querySelector(".lft-audio"), null);
assert.deepEqual(audioLoads, []);
precisePronunciations[0]!.querySelector(".lft-audio")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
precisePronunciations[1]!.querySelector(".lft-audio")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(audioLoads, ["first.mp3", "second.mp3"]);
assert.deepEqual(preciseAudio.played, ["mock:first.mp3", "mock:second.mp3"]);

// Older entries without resource keys still support region and index matching.
const legacyAudio = mount(async () => ({
  ...result,
  configuredDictionaries: 1,
  entries: [
    {
      ...entry("旧格式发音示例", [structured]),
      pronunciations: [
        { region: "英", text: "/ˈsɑːmpəl/" },
        { region: "未知地区", text: "/ˈsæmpəl/" },
      ],
      audio: [
        { region: "英", label: "英音", url: "mock:legacy-region" },
        { region: "美", label: "美音", url: "mock:legacy-index" },
      ],
    },
  ],
}));
await legacyAudio.instance.lookupLocal();
const legacyButtons = legacyAudio.root.querySelectorAll(".lft-audio");
assert.equal(legacyButtons.length, 2);
legacyButtons[0]!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
legacyButtons[1]!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(legacyAudio.played, [
  "mock:legacy-region",
  "mock:legacy-index",
]);
prefs.set("loadDictionaryAudio", false);

console.log(
  "dictionary display: semantic text hierarchy, safe query/form highlights, canonical annotations, source tabs and full long entries passed (mock DOM)",
);
