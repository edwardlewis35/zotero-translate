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
) {
  const doc = new TestDocument();
  let closes = 0;
  const card = new TranslationCard(
    doc as never,
    "sample",
    true,
    { lookup } as never,
    () => {},
    async () => {},
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
assert.equal(explanation.root.querySelectorAll("h3").length, 3);
assert.equal(explanation.root.querySelectorAll("ol").length, 1);
assert.equal(explanation.root.querySelectorAll("ul").length, 1);
assert.equal(explanation.root.querySelectorAll("strong").length, 2);
assert.equal(explanation.root.querySelectorAll("em").length, 1);
assert.equal(explanation.root.querySelectorAll("code").length, 1);
assert.equal(explanation.root.querySelector("img"), null);
assert.ok(
  explanation.root.textContent.includes("<img src=x onerror=alert(1)>"),
);

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
completedStream.responseText +=
  'data: {"type":"response.completed","response":{"status":"completed","output_text":"## sample\\n1. **n.** 示例\\n- A sample example.\\n- 示例句子。\\n<img src=x>"}}\n\n';
completedRequest.resolve(completedStream);
await completing;
assert.equal(toolbar(completed.root).disabled, false);
assert.equal(completed.root.querySelectorAll("h3").length, 1);
assert.equal(completed.root.querySelectorAll("strong").length, 1);
assert.equal(completed.root.querySelectorAll("li").length, 3);
assert.equal(completed.root.querySelector(".lft-translation-stream"), null);
assert.equal(completed.root.querySelector("img"), null);

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
  "card window: compact stable controls, explicit request disposal and inert Markdown explanations passed (mock DOM)",
);
