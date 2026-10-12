import assert from "node:assert/strict";
import { TranslationCard } from "../src/ui/card";
import type {
  LocalLookupOptions,
  LocalLookupResult,
} from "../src/dictionary/types";
import type { APIProfile } from "../src/prefs";
import { TestDocument, TestElement } from "./helpers/dom";

const profile: APIProfile = {
  id: "fallback",
  name: "Fallback API",
  endpoint: "https://example.invalid/v1",
  protocol: "responses",
  apiKey: "",
  model: "dictionary-model",
  temperature: "0.2",
  targetLanguage: "简体中文",
  prompt: "Explain ${sourceText}",
};
const prefs = new Map<string, unknown>();
function configure(profiles = [profile]) {
  prefs.set("apiProfiles", JSON.stringify(profiles));
  prefs.set("selectedApiProfileId", profiles[0]!.id);
  prefs.set("autoTranslateWord", true);
}
configure();

type Response = { status: number; responseText: string };
type RequestOptions = {
  body: string;
  cancellerReceiver: (cancel: () => void) => void;
  requestObserver: (request: Response & { onprogress?: () => void }) => void;
};
const requests: { url: string; body: Record<string, unknown> }[] = [];
const completed: Response = {
  status: 200,
  responseText: JSON.stringify({
    status: "completed",
    output_text:
      "### 词形\nstudies 是 study 的复数或第三人称单数。\n### 例句\nShe studies every day.\n她每天学习。",
  }),
};
let respond = async (_options: RequestOptions): Promise<Response> => completed;
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    HTTP: {
      request: (_method: string, url: string, options: RequestOptions) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return respond(options);
      },
    },
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
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const miss = (
  word = "studies",
  configuredDictionaries = 2,
): LocalLookupResult => ({
  word,
  configuredDictionaries,
  entries: [],
  errors: [],
});
const hit = (): LocalLookupResult => ({
  ...miss(),
  errors: ["Another dictionary could not open"],
  entries: [
    {
      headword: "study",
      source: "Test dictionary",
      pronunciations: [],
      audio: [],
      forms: [],
      tags: [],
      senses: [{ partOfSpeech: "n.", translation: "研究", lines: [] }],
    },
  ],
});
function mount(
  lookup: (
    word: string,
    options?: LocalLookupOptions,
  ) => Promise<LocalLookupResult>,
  text = "studies",
) {
  const doc = new TestDocument();
  const saved: string[] = [];
  const card = new TranslationCard(
    doc as never,
    text,
    true,
    { lookup } as never,
    () => {},
    async (text) => {
      saved.push(text);
    },
  );
  const root = card.root as unknown as TestElement;
  doc.documentElement.append(root);
  return { card, root, saved };
}

// A completed miss makes exactly one Responses request with the selected
// form, not a guessed stem. Keyless configured local backends are allowed.
for (const word of ["apples", "studies", "went", "driven", "running", "saw"]) {
  const before = requests.length;
  const current = mount(async () => miss(word), word);
  await current.card.lookupLocal();
  assert.equal(requests.length, before + 1);
  const request = requests.at(-1)!;
  assert.equal(request.url, "https://example.invalid/v1/responses");
  assert.equal(request.body.stream, true);
  const input = request.body.input as { role: string; content: string }[];
  assert.equal(input[1]!.content, `Explain ${word}`);
  assert.match(input[0]!.content, /完整.*词典条目/u);
  assert.ok(current.root.querySelector(".lft-translation-lines"));
}

// Empty progress is not a miss; later local success wins even with other errors.
let before = requests.length;
const progressive = mount(async (_word, options) => {
  options!.onProgress!({
    result: miss(),
    completed: 1,
    total: 2,
    message: "First dictionary missed",
  });
  assert.equal(requests.length, before);
  return hit();
});
await progressive.card.lookupLocal();
assert.equal(requests.length, before);
assert.ok(progressive.root.querySelector(".lft-dictionary"));

// No usable model/address keeps the original editor and never sends a request.
for (const unconfigured of [
  { ...profile, model: " " },
  { ...profile, endpoint: " " },
]) {
  configure([unconfigured]);
  const current = mount(async () => miss());
  await current.card.lookupLocal();
  assert.equal(requests.length, before);
  assert.ok(current.root.querySelector(".lft-word-input"));
}
configure();
const noDictionary = mount(async () => ({
  ...miss("studies", 0),
  errors: ["No enabled dictionary"],
}));
await noDictionary.card.lookupLocal();
assert.equal(requests.length, ++before);

// Auto查词关闭时仍等待手动操作；主动查询未命中后才接续 AI。
prefs.set("autoTranslateWord", false);
let lookups = 0;
const manual = mount(async () => {
  lookups++;
  return miss();
});
manual.card.start();
await flush();
assert.equal(lookups, 0);
assert.equal(requests.length, before);
await manual.card.lookupLocal();
assert.equal(requests.length, ++before);
configure();

// Local return is an explicit inspection path; it must not create a loop.
manual.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "本地词典")!
  .click();
await flush();
assert.equal(requests.length, before);
assert.ok(manual.root.querySelector(".lft-word-input"));

// A dictionary exception is not a completed zero-hit query.
const failure = mount(async () => {
  throw new Error("Dictionary configuration changed");
});
await failure.card.lookupLocal();
assert.equal(requests.length, before);
assert.ok(
  failure.root.textContent.includes("Dictionary configuration changed"),
);

// Closed/detached/replaced queries cannot start a late model request.
for (const close of ["dispose", "detach", "supersede"] as const) {
  const pending = deferred<LocalLookupResult>();
  let count = 0;
  const current = mount(async () => (++count === 1 ? pending.promise : hit()));
  const lookup = current.card.lookupLocal();
  if (close === "dispose") current.card.dispose();
  if (close === "detach") current.root.remove();
  if (close === "supersede") await current.card.lookupLocal();
  pending.resolve(miss());
  await lookup;
  assert.equal(requests.length, before);
}

// Manual AI supersedes an in-flight dictionary query without a second call.
const pendingLocal = deferred<LocalLookupResult>();
const overtaken = mount(async () => pendingLocal.promise);
const lookup = overtaken.card.lookupLocal();
await overtaken.card.translateOnline();
assert.equal(requests.length, ++before);
pendingLocal.resolve(miss());
await lookup;
assert.equal(requests.length, before);

// Resolve the chosen model after lookup, so a user can change it while waiting.
const second = { ...profile, id: "second", model: "second-model" };
configure([profile, second]);
const pendingModel = deferred<LocalLookupResult>();
const switched = mount(async () => pendingModel.promise);
const changing = switched.card.lookupLocal();
const picker = switched.root.querySelector(".lft-model-select")!;
picker.value = second.id;
picker.dispatchEvent(new Event("change"));
pendingModel.resolve(miss());
await changing;
assert.equal(requests.length, ++before);
assert.equal(requests.at(-1)!.body.model, second.model);
configure();

// Streaming and annotation editing use the same lifecycle as manual AI.
const network = deferred<Response>();
let options!: RequestOptions;
let cancellations = 0;
respond = async (value) => {
  options = value;
  value.cancellerReceiver(() => {
    cancellations++;
    network.reject(new Error("cancelled"));
  });
  return network.promise;
};
const streamed = mount(async () => miss());
const translating = streamed.card.lookupLocal();
await flush();
assert.equal(requests.length, ++before);
assert.ok(streamed.root.textContent.includes("本地词典未命中"));
const xhr = {
  status: 200,
  responseText: "",
  onprogress: undefined as (() => void) | undefined,
};
options.requestObserver(xhr);
xhr.responseText =
  'data: {"type":"response.output_text.delta","delta":"studies：学习；研究"}\n\n';
xhr.onprogress!();
assert.equal(
  streamed.root.querySelector(".lft-translation-stream")!.textContent,
  "studies：学习；研究",
);
const draft = streamed.root.querySelector(".lft-annotation-draft-input")!;
draft.value = "只保存我的解释";
draft.dispatchEvent(new Event("input"));
network.resolve(completed);
await translating;
assert.equal(
  streamed.root.querySelector(".lft-annotation-draft-input")!.value,
  draft.value,
);
streamed.root.querySelector(".lft-button-annotation")!.click();
await flush();
assert.deepEqual(streamed.saved, [draft.value]);

const cancelledNetwork = deferred<Response>();
respond = async (value) => {
  value.cancellerReceiver(() => {
    cancellations++;
    cancelledNetwork.reject(new Error("cancelled"));
  });
  return cancelledNetwork.promise;
};
const cancelled = mount(async () => miss());
const cancelling = cancelled.card.lookupLocal();
await flush();
assert.equal(requests.length, ++before);
cancelled.card.dispose();
await cancelling;
assert.equal(cancellations, 1);

respond = async () => ({
  status: 401,
  responseText: JSON.stringify({
    error: { message: "Invalid test credential" },
  }),
});
const failedAI = mount(async () => miss());
await failedAI.card.lookupLocal();
assert.equal(requests.length, ++before);
assert.ok(failedAI.root.textContent.includes("大模型翻译失败"));
failedAI.root
  .querySelectorAll("button")
  .find((button) => button.textContent === "返回本地词典")!
  .click();
await flush();
assert.equal(requests.length, before);
assert.ok(failedAI.root.querySelector(".lft-word-input"));

console.log(
  "Automatic dictionary fallback: exact inflections, final misses, configured models, manual return, streaming, drafts and request races passed",
);
