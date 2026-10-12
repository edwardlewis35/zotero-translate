import assert from "node:assert/strict";
import { TranslationCard } from "../src/ui/card";
import type {
  LocalLookupOptions,
  LocalLookupResult,
} from "../src/dictionary/types";
import type { APIProfile } from "../src/prefs";
import { TestDocument, TestElement } from "./helpers/dom";

const profile: APIProfile = {
  id: "mock",
  name: "Mock API",
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
  ["selectedApiProfileId", profile.id],
]);
const copied: string[] = [];
let handleRequest: (options: RequestOptions) => Promise<Response>;
type Response = { status: number; responseText: string };
type RequestOptions = {
  cancellerReceiver: (cancel: () => void) => void;
  requestObserver: (request: Response & { onprogress?: () => void }) => void;
};
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    HTTP: {
      request: (_method: string, _url: string, options: RequestOptions) =>
        handleRequest(options),
    },
    Utilities: {
      Internal: { copyTextToClipboard: (text: string) => copied.push(text) },
    },
    logError: () => {},
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mount(
  lookup: (
    word: string,
    options?: LocalLookupOptions,
  ) => Promise<LocalLookupResult>,
  selection = "sample",
  isWord = true,
) {
  const doc = new TestDocument();
  const saved: string[] = [];
  let closes = 0;
  const card = new TranslationCard(
    doc as never,
    selection,
    isWord,
    { lookup } as never,
    () => {},
    async (translation) => {
      saved.push(translation);
    },
    () => {
      closes++;
      card.dispose();
      card.root.remove();
    },
  );
  const root = card.root as unknown as TestElement;
  doc.documentElement.append(root);
  return {
    card,
    root,
    saved,
    get closes() {
      return closes;
    },
  };
}

const local: LocalLookupResult = {
  word: "sample",
  configuredDictionaries: 1,
  errors: [],
  entries: [
    {
      headword: "sample",
      source: "Invented dictionary",
      pronunciations: [],
      audio: [],
      forms: [],
      tags: [],
      senses: [{ partOfSpeech: "n.", translation: "示例", lines: [] }],
    },
  ],
};

function toolbar(root: TestElement) {
  const header = root.querySelector(".lft-card-header")!;
  const actions = header.querySelector(".lft-card-actions")!;
  assert.equal(actions.children[0]!.className, "lft-model-picker");
  assert.equal(actions.children[0]!.children[0]!.textContent, "模型");
  assert.equal(actions.children[1]!.textContent, "写入批注");
  assert.equal(header.querySelector(".lft-card-mark"), null);
  assert.equal(header.querySelector(".lft-card-title"), null);
  assert.equal(header.querySelector(".lft-card-subtitle"), null);
  assert.ok(!header.textContent.includes("sample"));
  assert.ok(header.querySelector(".lft-close-button"));
  return actions.children[1]!;
}

// Header controls remain stable in idle/loading/success and only a completed
// dictionary/API result enables annotation saving. The body keeps its headword.
const visible = mount(async () => local);
visible.card.start();
assert.equal(toolbar(visible.root).disabled, true);
await visible.card.lookupLocal();
assert.equal(toolbar(visible.root).disabled, false);
assert.equal(
  visible.root.querySelector(".lft-dictionary-headword")!.textContent,
  "sample",
);
visible.root.querySelector(".lft-close-button")!.click();
assert.equal(visible.closes, 1);
assert.equal(visible.root.isConnected, false);

// Explicit disposal cancels a dictionary operation even if its old root is
// still connected; late progress and completion cannot repaint an old card.
const waiting = deferred<LocalLookupResult>();
let lookupOptions!: LocalLookupOptions;
let lookups = 0;
const retired = mount(async (_word, options) => {
  lookups++;
  lookupOptions = options!;
  return waiting.promise;
});
const pendingLookup = retired.card.lookupLocal();
const beforeDispose = retired.root.textContent;
assert.equal(toolbar(retired.root).disabled, true);
retired.card.dispose();
retired.card.dispose();
assert.equal(lookupOptions.isCancelled?.(), true);
lookupOptions.onProgress?.({
  result: local,
  completed: 1,
  total: 1,
  message: "late result",
});
waiting.resolve(local);
await pendingLookup;
await retired.card.lookupLocal();
await retired.card.translateOnline();
assert.equal(lookups, 1);
assert.equal(retired.root.textContent, beforeDispose);

// A host may provide its canceller after the user already closed the card.
// Immediately invoke this late handle rather than retaining a live request.
const network = deferred<Response>();
let receivedOptions!: RequestOptions;
let cancellations = 0;
handleRequest = async (options) => {
  receivedOptions = options;
  return network.promise;
};
const closed = mount(async () => local);
const pendingOnline = closed.card.translateOnline();
assert.equal(toolbar(closed.root).disabled, true);
const beforeClose = closed.root.textContent;
closed.card.dispose();
receivedOptions.cancellerReceiver(() => {
  cancellations++;
  network.reject(new Error("cancelled"));
});
await pendingOnline;
assert.equal(cancellations, 1);
assert.equal(closed.root.textContent, beforeClose);

// Render provider Markdown as inert elements, preserving dictionary sections,
// bilingual examples and literal HTML text without creating executable nodes.
handleRequest = async () => ({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text:
      "## sample\n### 词性与释义\n1. **n.** 示例\n2. **v.** 抽样\n### 例句\n- Here is a *sample*.\n- 这里是一个示例。\n<img src=x onerror=alert(1)>\n`literal code`",
  }),
});
const explanation = mount(async () => local);
await explanation.card.translateOnline();
assert.equal(toolbar(explanation.root).disabled, false);
assert.equal(explanation.root.querySelectorAll("h3").length, 2);
assert.equal(
  explanation.root.querySelectorAll(".lft-dictionary-headword").length,
  1,
);
assert.equal(
  explanation.root.querySelector(".lft-dictionary-headword")!.textContent,
  "sample",
);
assert.deepEqual(
  explanation.root
    .querySelectorAll("summary")
    .map((summary) => summary.textContent),
  ["词性与释义", "例句"],
  "remove an exact leading duplicate headword while keeping provider section titles",
);
assert.ok(
  explanation.root.querySelectorAll("details").every((section) => section.open),
);
assert.equal(explanation.root.querySelectorAll("ol").length, 1);
assert.equal(explanation.root.querySelectorAll("ul").length, 1);
assert.equal(explanation.root.querySelectorAll("strong").length, 2);
assert.equal(explanation.root.querySelectorAll("em").length, 1);
assert.equal(explanation.root.querySelectorAll("code").length, 1);
assert.equal(explanation.root.querySelector("img"), null);
assert.ok(
  explanation.root.textContent.includes("<img src=x onerror=alert(1)>"),
);

// Query highlighting wraps inert Markdown text, including inline emphasis and
// code, without changing provider text used for annotations or copying.
const highlightedProviderText = [
  "## bank",
  "### BANK usage",
  "A bank and a banker; banked is not a supplied form.",
  "**BANK** *bank* `bank`.",
  "<img src=x onerror=alert(1)> bank <script>bank</script>",
].join("\n");
handleRequest = async () => ({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text: highlightedProviderText,
  }),
});
const highlighted = mount(async () => local, "bank");
await highlighted.card.translateOnline();
const highlightedLines = highlighted.root.querySelector(
  ".lft-translation-lines",
)!;
assert.deepEqual(
  highlightedLines
    .querySelectorAll("p")
    .map((paragraph) => paragraph.textContent),
  [
    "A bank and a banker; banked is not a supplied form.",
    "BANK bank bank.",
    "<img src=x onerror=alert(1)> bank <script>bank</script>",
  ],
  "highlighting preserves the plain text of Markdown and literal HTML",
);
assert.equal(highlightedLines.querySelector("h3")!.textContent, "BANK usage");
for (const [tag, text] of [
  ["strong", "BANK"],
  ["em", "bank"],
  ["code", "bank"],
]) {
  const inline = highlightedLines.querySelector(tag!)!;
  assert.equal(inline.textContent, text);
  assert.equal(inline.querySelector(".lft-query-word")!.textContent, text);
}
const providerMarks = highlightedLines.querySelectorAll(".lft-query-word");
assert.deepEqual(
  providerMarks.map((mark) => mark.textContent),
  ["BANK", "bank", "BANK", "bank", "bank", "bank", "bank"],
  "banker and an unsupplied inflection banked remain unmarked",
);
assert.ok(providerMarks.every((mark) => mark.tagName === "mark"));
assert.equal(highlightedLines.querySelector("img"), null);
assert.equal(highlightedLines.querySelector("script"), null);
for (const selector of [
  ".lft-card-header",
  ".lft-dictionary-header",
  ".lft-dictionary-tabs",
  ".lft-footer",
])
  assert.equal(
    highlighted.root.querySelector(selector)!.querySelector(".lft-query-word"),
    null,
  );
highlighted.root.querySelector(".lft-button-annotation")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(highlighted.saved[0], highlightedProviderText);
assert.ok(!highlighted.saved[0]!.includes("<mark"));
assert.ok(!highlighted.saved[0]!.includes("lft-query-word"));
highlighted.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "复制")!
  .click();
assert.equal(copied.at(-1), highlightedProviderText);

// Deduplication is deliberately narrow: inflections, phonetics, longer
// headings and later repeated headings are provider content, not duplicates.
for (const heading of [
  "samples",
  "sample /ˈsæmpəl/",
  "sample usage",
  "**sample**",
]) {
  handleRequest = async () => ({
    status: 200,
    responseText: JSON.stringify({
      status: "completed",
      output_text: `## ${heading}\nMeaning text.`,
    }),
  });
  const retained = mount(async () => local);
  await retained.card.translateOnline();
  assert.equal(retained.root.querySelectorAll("summary").length, 1);
  assert.ok(
    retained.root
      .querySelector("summary")!
      .textContent.includes(heading.replaceAll("**", "")),
  );
  assert.ok(retained.root.textContent.includes("Meaning text."));
}
handleRequest = async () => ({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text:
      "## SAMPLE\nA preserved meaning.\n## sample\nA later heading stays.",
  }),
});
const duplicate = mount(async () => local);
await duplicate.card.translateOnline();
assert.deepEqual(
  duplicate.root
    .querySelectorAll("summary")
    .map((summary) => summary.textContent),
  ["词典释义", "sample"],
);
assert.ok(duplicate.root.textContent.includes("A later heading stays."));
duplicate.root.querySelector(".lft-button-annotation")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  duplicate.saved[0],
  "## SAMPLE\nA preserved meaning.\n## sample\nA later heading stays.",
);

// Paragraph results never borrow a word header or strip their first heading.
handleRequest = async () => ({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text:
      "## A complete sentence.\n完整句子的译文。\n### <script>alert(1)</script>\nLiteral heading text.",
  }),
});
const paragraph = mount(async () => local, "A complete sentence.", false);
await paragraph.card.translateOnline();
assert.equal(paragraph.root.querySelector(".lft-dictionary-headword"), null);
assert.equal(
  paragraph.root.querySelector(".lft-dictionary-tab")!.textContent,
  "译文",
);
assert.deepEqual(
  paragraph.root
    .querySelectorAll("summary")
    .map((summary) => summary.textContent),
  ["A complete sentence.", "<script>alert(1)</script>"],
);
assert.equal(paragraph.root.querySelector("script"), null);
assert.ok(paragraph.root.textContent.includes("完整句子的译文。"));

// Live text stays inert while arriving, then a successful completion switches
// to the semantic Markdown display and enables saving the complete result.
const completedRequest = deferred<Response>();
let completedStream!: Response & { onprogress?: () => void };
handleRequest = async (options) => {
  options.cancellerReceiver(() =>
    completedRequest.reject(new Error("cancelled")),
  );
  completedStream = { status: 200, responseText: "" };
  options.requestObserver(completedStream);
  return completedRequest.promise;
};
const completed = mount(async () => local);
const completing = completed.card.translateOnline();
completedStream.responseText =
  'data: {"type":"response.output_text.delta","delta":"## sample\\n1. **n.** 示例\\n- A sample example.\\n- 示例句子。\\n<img src=x>"}\n\n';
completedStream.onprogress?.();
assert.equal(toolbar(completed.root).disabled, true);
assert.equal(completed.root.querySelector("h3"), null);
assert.equal(completed.root.querySelector("img"), null);
assert.equal(
  completed.root.querySelector(".lft-translation-stream")!.textContent,
  "## sample\n1. **n.** 示例\n- A sample example.\n- 示例句子。\n<img src=x>",
  "live highlights preserve the exact accumulated provider text",
);
assert.deepEqual(
  completed.root
    .querySelector(".lft-translation-stream")!
    .querySelectorAll(".lft-query-word")
    .map((mark) => mark.textContent),
  ["sample", "sample"],
);
completedStream.responseText +=
  'data: {"type":"response.completed","response":{"status":"completed","output_text":"## sample\\n1. **n.** 示例\\n- A sample example.\\n- 示例句子。\\n<img src=x>"}}\n\n';
completedRequest.resolve(completedStream);
await completing;
assert.equal(toolbar(completed.root).disabled, false);
assert.equal(completed.root.querySelectorAll("h3").length, 1);
assert.equal(completed.root.querySelector("summary")!.textContent, "词典释义");
assert.equal(
  completed.root.querySelectorAll(".lft-dictionary-headword").length,
  1,
);
assert.equal(completed.root.querySelectorAll("strong").length, 1);
assert.equal(completed.root.querySelectorAll("li").length, 3);
assert.equal(completed.root.querySelector(".lft-translation-stream"), null);
assert.equal(completed.root.querySelector("img"), null);
assert.equal(
  completed.root.querySelector(".lft-translation-lines")!.textContent,
  "词典释义n. 示例A sample example.示例句子。<img src=x>",
  "final semantic display keeps the text after removing Markdown syntax and the duplicate headword",
);
assert.deepEqual(
  completed.root
    .querySelector(".lft-translation-lines")!
    .querySelectorAll(".lft-query-word")
    .map((mark) => mark.textContent),
  ["sample"],
);

// A query split across SSE deltas becomes a mark only after the whole word
// arrives. Redrawing progress must replace old marks rather than duplicate text.
const highlightedRequest = deferred<Response>();
let highlightedStream!: Response & { onprogress?: () => void };
handleRequest = async (options) => {
  options.cancellerReceiver(() =>
    highlightedRequest.reject(new Error("cancelled")),
  );
  highlightedStream = { status: 200, responseText: "" };
  options.requestObserver(highlightedStream);
  return highlightedRequest.promise;
};
const streamed = mount(async () => local, "bank");
const streamedCompletion = streamed.card.translateOnline();
let streamedText = "";
for (const [delta, matches] of [
  ["BAN", []],
  ["K banker <img src=x>", ["BANK"]],
  ["\nA bank example.", ["BANK", "bank"]],
] as [string, string[]][]) {
  streamedText += delta;
  highlightedStream.responseText += `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`;
  highlightedStream.onprogress?.();
  const live = streamed.root.querySelector(".lft-translation-stream")!;
  assert.equal(live.textContent, streamedText);
  assert.deepEqual(
    live.querySelectorAll(".lft-query-word").map((mark) => mark.textContent),
    matches,
  );
  assert.ok(
    live
      .querySelectorAll(".lft-query-word")
      .every((mark) => mark.tagName === "mark"),
  );
  assert.equal(live.querySelector("img"), null);
  assert.equal(toolbar(streamed.root).disabled, true);
  assert.equal(
    streamed.root
      .querySelector(".lft-dictionary-header")!
      .querySelector(".lft-query-word"),
    null,
  );
}
highlightedStream.responseText += `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output_text: streamedText } })}\n\n`;
highlightedRequest.resolve(highlightedStream);
await streamedCompletion;
assert.equal(streamed.root.querySelector(".lft-translation-stream"), null);
const finalHighlightedLines = streamed.root.querySelector(
  ".lft-translation-lines",
)!;
assert.equal(
  finalHighlightedLines.textContent,
  "词典释义BANK banker <img src=x>A bank example.",
);
assert.deepEqual(
  finalHighlightedLines
    .querySelectorAll(".lft-query-word")
    .map((mark) => mark.textContent),
  ["BANK", "bank"],
);
assert.equal(finalHighlightedLines.querySelector("img"), null);
assert.equal(toolbar(streamed.root).disabled, false);
streamed.root.querySelector(".lft-button-annotation")!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(streamed.saved[0], streamedText);
streamed.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "复制")!
  .click();
assert.equal(copied.at(-1), streamedText);

// Switching a pending online explanation back to a local source invalidates
// its progress/completion so it cannot replace the newly selected IPA/body.
const supersededRequest = deferred<Response>();
let supersededStream!: Response & { onprogress?: () => void };
let supersededCancellations = 0;
handleRequest = async (options) => {
  options.cancellerReceiver(() => supersededCancellations++);
  supersededStream = { status: 200, responseText: "" };
  options.requestObserver(supersededStream);
  return supersededRequest.promise;
};
const switched = mount(async () => local);
const supersededOnline = switched.card.translateOnline();
await switched.card.lookupLocal();
const selectedLocalText = switched.root.textContent;
supersededStream.responseText =
  'data: {"type":"response.output_text.delta","delta":"## late replacement"}\n\n';
supersededStream.onprogress?.();
supersededRequest.resolve({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text: "## late replacement",
  }),
});
await supersededOnline;
assert.equal(supersededCancellations, 1);
assert.equal(switched.root.textContent, selectedLocalText);
assert.equal(
  switched.root.querySelector(".lft-dictionary-tab")!.textContent,
  "Invented dictionary",
);
assert.equal(
  switched.root.querySelectorAll(".lft-dictionary-headword").length,
  1,
);

// Closing with an already registered canceller invalidates both late progress
// and late successful completion even when the upstream fails to abort.
const closingRequest = deferred<Response>();
let closingStream!: Response & { onprogress?: () => void };
let earlyCancellations = 0;
handleRequest = async (options) => {
  options.cancellerReceiver(() => earlyCancellations++);
  closingStream = { status: 200, responseText: "" };
  options.requestObserver(closingStream);
  return closingRequest.promise;
};
const closing = mount(async () => local);
const closingOnline = closing.card.translateOnline();
closing.root.querySelector(".lft-close-button")!.click();
const retiredText = closing.root.textContent;
assert.equal(earlyCancellations, 1);
assert.equal(closing.closes, 1);
closingStream.responseText =
  'data: {"type":"response.output_text.delta","delta":"late text"}\n\n';
closingStream.onprogress?.();
closingRequest.resolve({
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text: "late text",
  }),
});
await closingOnline;
assert.equal(closing.root.textContent, retiredText);
assert.equal(closing.root.isConnected, false);

// A stopped partial stream is readable but not a completed dictionary result.
const stoppedRequest = deferred<Response>();
let stream!: Response & { onprogress?: () => void };
handleRequest = async (options) => {
  options.cancellerReceiver(() =>
    stoppedRequest.reject(new Error("cancelled")),
  );
  stream = { status: 200, responseText: "" };
  options.requestObserver(stream);
  return stoppedRequest.promise;
};
const stopped = mount(async () => local);
const streaming = stopped.card.translateOnline();
stream.responseText =
  'data: {"type":"response.output_text.delta","delta":"partial explanation"}\n\n';
stream.onprogress?.();
const stop = stopped.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "停止")!;
stop.click();
await streaming;
assert.ok(stopped.root.textContent.includes("partial explanation"));
assert.equal(toolbar(stopped.root).disabled, true);

console.log(
  "card window: stable controls, safe Markdown/stream highlights, unchanged annotations/copy and explicit request disposal passed (mock DOM)",
);
