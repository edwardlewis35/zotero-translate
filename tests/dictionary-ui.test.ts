import assert from "node:assert/strict";
import { TranslationCard } from "../src/ui/card";
import { PreferencesController } from "../src/preferences";
import type {
  LocalLookupOptions,
  LocalLookupResult,
} from "../src/dictionary/types";
import { TestDocument, TestElement } from "./helpers/dom";

const prefs = new Map<string, unknown>();
const errors: unknown[] = [];
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) =>
        prefs.set(key.split(".").at(-1)!, value),
    },
    logError: (error: unknown) => errors.push(error),
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function result(
  source = "Alpha",
  audio: LocalLookupResult["entries"][number]["audio"] = [],
): LocalLookupResult {
  return {
    word: "test",
    configuredDictionaries: 1,
    errors: [],
    entries: [
      {
        source,
        headword: "test",
        pronunciations: [{ region: "英", text: "/test/" }],
        forms: [],
        tags: [],
        audio,
        senses: [
          {
            partOfSpeech: "n.",
            translation: "测试",
            lines: [{ text: "测试", kind: "definition" }],
          },
        ],
      },
    ],
  };
}

function button(root: TestElement, text: string) {
  return root
    .querySelectorAll("button")
    .find((element) => element.textContent === text);
}

function card(
  lookup: (
    word: string,
    options?: LocalLookupOptions,
  ) => Promise<LocalLookupResult>,
  mount = true,
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
    "test",
    true,
    { lookup } as never,
    () => {},
    async (translation) => {
      saved.push(translation);
    },
  );
  const root = instance.root as unknown as TestElement;
  if (mount) doc.documentElement.append(root);
  return { doc, root, instance, played, saved };
}

// The first MDX result is visible without waiting for all dictionaries. Saving
// remains unavailable until the complete result arrives, as in the base UI.
const all = deferred<LocalLookupResult>();
const partial = result();
partial.configuredDictionaries = 2;
const incremental = card(async (_word, options) => {
  options?.onProgress?.({
    result: partial,
    completed: 1,
    total: 2,
    message: "正在打开 Beta",
  });
  return all.promise;
});
const querying = incremental.instance.lookupLocal();
assert.ok(incremental.root.textContent.includes("Alpha"));
assert.ok(incremental.root.textContent.includes("正在打开 Beta"));
assert.equal(button(incremental.root, "写入批注"), undefined);
const complete = {
  ...partial,
  entries: [...partial.entries, ...result("Beta").entries],
};
all.resolve(complete);
await querying;
assert.ok(incremental.root.textContent.includes("Beta"));
assert.equal(incremental.saved.length, 0, "do not introduce automatic saving");
button(incremental.root, "写入批注")!.click();
await flush();
assert.equal(incremental.saved.length, 1);
assert.ok(
  incremental.saved[0].includes("Alpha") &&
    incremental.saved[0].includes("Beta"),
);
assert.ok(incremental.root.textContent.includes("下划线批注"));
assert.ok(!incremental.root.textContent.includes("高亮批注"));

// Reader append can finish after card.start(). An initially detached popup
// must not cancel a legitimate first query.
const mounting = deferred<LocalLookupResult>();
const delayedMount = card(async (_word, options) => {
  assert.equal(options?.isCancelled?.(), false);
  return mounting.promise;
}, false);
const beforeMount = delayedMount.instance.lookupLocal();
delayedMount.doc.documentElement.append(delayedMount.root);
mounting.resolve(result());
await beforeMount;
assert.ok(delayedMount.root.textContent.includes("Alpha"));

// A visible pronunciation is independent of optional audio resources.
prefs.set("loadDictionaryAudio", false);
const silent = card(async () => result());
await silent.instance.lookupLocal();
assert.ok(silent.root.textContent.includes("/test/"));
assert.equal(silent.root.querySelector(".lft-audio"), null);

// Only an explicit click loads audio; repeated clicks while pending are ignored.
prefs.set("loadDictionaryAudio", true);
const sound = deferred<string>();
let audioLoads = 0;
const withSound = card(async () =>
  result("Alpha", [
    {
      label: "test",
      region: "英",
      load: () => {
        audioLoads++;
        return sound.promise;
      },
    },
  ]),
);
await withSound.instance.lookupLocal();
assert.equal(audioLoads, 0);
const play = withSound.root.querySelector(".lft-audio")!;
play.click();
play.click();
assert.equal(audioLoads, 1);
assert.equal(play.disabled, true);
sound.resolve("data:audio/mpeg;base64,AQID");
await flush();
assert.deepEqual(withSound.played, ["data:audio/mpeg;base64,AQID"]);
assert.equal(play.disabled, false);

// A popup closed during MDD loading must not start late playback.
const lateSound = deferred<string>();
const closed = card(async () =>
  result("Alpha", [
    { label: "test", region: "英", load: () => lateSound.promise },
  ]),
);
await closed.instance.lookupLocal();
closed.root.querySelector(".lft-audio")!.click();
closed.root.remove();
lateSound.resolve("data:audio/mpeg;base64,AQID");
await flush();
assert.equal(closed.played.length, 0);

// Disabling audio while a pending load completes is checked before playback.
const disabledSound = deferred<string>();
const disabled = card(async () =>
  result("Alpha", [
    { label: "test", region: "英", load: () => disabledSound.promise },
  ]),
);
await disabled.instance.lookupLocal();
const disabledPlay = disabled.root.querySelector(".lft-audio")!;
disabledPlay.click();
prefs.set("loadDictionaryAudio", false);
disabledSound.resolve("data:audio/mpeg;base64,AQID");
await flush();
assert.equal(disabled.played.length, 0);
assert.equal(disabledPlay.disabled, false);
assert.ok(disabledPlay.title.includes("关闭"));

// The actual settings handler persists the switch and releases MDD resources
// without discarding MDX indexes.
const settings = new TestDocument();
const checkbox = settings.createElement("checkbox");
checkbox.id = "lft-load-audio";
const status = settings.createElement("span");
status.id = "lft-settings-status";
settings.documentElement.append(checkbox, status);
let releases = 0;
const preferences = new PreferencesController({
  releaseAudio: () => {
    releases++;
  },
  reset: () => {
    throw new Error("MDX indexes must not be reset");
  },
} as never);
preferences["bindCheckbox"](
  settings as never,
  checkbox.id,
  "loadDictionaryAudio",
  false,
);
checkbox.checked = true;
checkbox.dispatchEvent(new Event("command"));
assert.equal(prefs.get("loadDictionaryAudio"), true);
assert.equal(releases, 0);
checkbox.checked = false;
checkbox.dispatchEvent(new Event("command"));
assert.equal(prefs.get("loadDictionaryAudio"), false);
assert.equal(releases, 1);
assert.ok(status.textContent.includes("不读取 MDD"));

console.log(
  "dictionary UI: incremental results, deferred audio, closed-popup safety and settings toggle passed (mock DOM)",
);
