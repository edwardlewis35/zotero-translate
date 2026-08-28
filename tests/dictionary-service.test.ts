import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDictionaryService } from "../src/dictionary/service";
import { mdictFixture } from "./helpers/mdict-fixture";

const directory = await mkdtemp(path.join(tmpdir(), "lexiflow-service-"));
const alpha = path.join(directory, "Alpha.mdx");
const beta = path.join(directory, "Beta.mdx");
const mddPath = path.join(directory, "Alpha.mdd");
const mddPart = path.join(directory, "Alpha.1.mdd");
const events: string[] = [];
const errors: unknown[] = [];
let parses = 0;
let resourceScans = 0;
let statGate: Promise<void> | undefined;
const configs = [
  {
    id: "alpha",
    name: "Alpha",
    enabled: true,
    mdxPath: alpha,
    mddPaths: [] as string[],
  },
  {
    id: "beta",
    name: "Beta",
    enabled: true,
    mdxPath: beta,
    mddPaths: [] as string[],
  },
];
const prefs = new Map<string, unknown>();
const saveConfigs = () =>
  prefs.set("dictionaryConfigs", JSON.stringify(configs));
saveConfigs();
const definition =
  "<span class='phon'>/test/</span><a href='sound://uk/test.mp3'>英</a>测试；试验";

// A minimal inert DOM fixture. The service uses the real HTML-parser entry
// point with simulated selectors; this is not a browser layout test.
class FixtureDOMParser {
  parseFromString(html: string) {
    parses++;
    const textContent = html.replace(/<[^>]*>/gu, "");
    const href = html.match(/href='([^']*)'/u)?.[1];
    const phon = html.match(/class='phon'>([^<]*)/u)?.[1];
    const element = (text: string, href?: string) => ({
      textContent: text,
      className: "",
      parentElement: null,
      getAttribute: (name: string) => (name === "href" ? href || null : null),
    });
    return {
      body: { textContent },
      documentElement: { textContent },
      querySelectorAll: (selector: string) => {
        if (selector === "[href], [src]")
          return href ? [element("英", href)] : [];
        if (selector.startsWith(".phon,")) return phon ? [element(phon)] : [];
        return [];
      },
    };
  }
}

Object.assign(globalThis, {
  DOMParser: FixtureDOMParser,
  Zotero: {
    Prefs: {
      get: (name: string) => prefs.get(name.split(".").at(-1)!),
      set: (name: string, value: unknown) =>
        prefs.set(name.split(".").at(-1)!, value),
    },
    Promise: { delay: async () => {} },
    logError: (error: unknown) => errors.push(error),
  },
  IOUtils: {
    exists: async (file: string) => {
      events.push(`exists:${path.basename(file)}`);
      try {
        await stat(file);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (file: string) => {
      events.push(`stat:${path.basename(file)}`);
      if (statGate) await statGate;
      const info = await stat(file);
      return { size: info.size, lastModified: info.mtimeMs };
    },
    getChildren: async (folder: string) => {
      resourceScans++;
      return (await readdir(folder)).map((name) => path.join(folder, name));
    },
  },
});

const service = new LocalDictionaryService();
try {
  await writeFile(
    alpha,
    mdictFixture([
      ["test", definition],
      ["tested", "@@@LINK=test"],
      ["loop", "@@@LINK=loop"],
    ]),
  );
  await writeFile(beta, mdictFixture([["test", "第二部词典：测试"]]));
  await writeFile(
    mddPath,
    mdictFixture([["\\unrelated.mp3", "unused"]], { mdd: true }),
  );
  const sound = Buffer.from([1, 99, 0, 222, 255, 88]);
  await writeFile(
    mddPart,
    mdictFixture([["\\uk\\test.mp3", sound]], { mdd: true }),
  );

  const initial = await service.lookup("test", {
    onProgress: ({ result, message }) =>
      events.push(`progress:${result.entries.length}:${message}`),
  });
  assert.equal(initial.entries.length, 2);
  assert.deepEqual(
    initial.entries[0].pronunciations.map((p) => p.text),
    ["/test/"],
  );
  assert.ok(initial.entries.every((item) => item.audio.length === 0));
  assert.equal(
    resourceScans,
    0,
    "default audio-off lookup must never scan MDD directories",
  );
  assert.ok(
    !events.some((event) => /\.mdd/u.test(event)),
    "no MDD stat or existence checks during text lookup",
  );
  const firstResult = events.findIndex((event) =>
    event.startsWith("progress:1:"),
  );
  const secondDictionary = events.indexOf("stat:Beta.mdx");
  assert.ok(
    firstResult >= 0 && firstResult < secondDictionary,
    "first result must arrive before the next dictionary opens",
  );
  assert.equal(parses, 2, "each matched entry is parsed into HTML only once");

  events.length = 0;
  await service.lookup("test");
  assert.equal(parses, 2, "repeated lookup must reuse parsed entries");
  assert.ok(!events.some((event) => event.includes("建立索引")));

  configs[0].name = "Renamed Alpha";
  saveConfigs();
  service.configurationChanged();
  const renamed = await service.lookup("test");
  assert.equal(renamed.entries[0].source, "Renamed Alpha");
  assert.equal(
    parses,
    2,
    "renaming must not discard a ready index or query cache",
  );

  prefs.set("loadDictionaryAudio", true);
  const withAudio = await service.lookup("test");
  assert.equal(
    resourceScans,
    0,
    "audio-on lookup still must not load audio before a click",
  );
  assert.equal(withAudio.entries[0].audio.length, 1);
  assert.equal(withAudio.entries[0].audio[0].url, undefined);
  const play = withAudio.entries[0].audio[0].load!;
  const [url, duplicate] = await Promise.all([play(), play()]);
  assert.equal(url, `data:audio/mpeg;base64,${sound.toString("base64")}`);
  assert.equal(url, duplicate);
  assert.equal(
    resourceScans,
    1,
    "simultaneous playback shares one resource lookup",
  );
  await play();
  assert.equal(resourceScans, 1, "repeated playback uses the audio cache");

  prefs.set("loadDictionaryAudio", false);
  service.releaseAudio();
  await assert.rejects(play(), /关闭/u);
  const beforeParses = parses;
  const afterDisable = await service.lookup("test");
  assert.equal(afterDisable.entries[0].audio.length, 0);
  assert.equal(
    parses,
    beforeParses,
    "disabling audio preserves the MDX and text cache",
  );

  const linked = await service.lookup("tested");
  assert.equal(linked.entries[0].headword, "test");
  assert.equal((await service.lookup("loop")).entries.length, 0);

  configs[1].enabled = false;
  saveConfigs();
  service.configurationChanged();
  events.length = 0;
  assert.equal((await service.lookup("test")).entries.length, 1);
  assert.ok(!events.some((event) => event.includes("Beta")));

  await writeFile(
    alpha,
    mdictFixture([["test", "词典文件在原路径更新后，应读到新的释义。"]]),
  );
  const changed = await service.lookup("test");
  assert.ok(
    changed.entries[0].senses.some((sense) =>
      sense.translation.includes("新的释义"),
    ),
  );

  // An obsolete lookup must not recreate indexes after reset while stat waits.
  service.reset();
  let unblock!: () => void;
  statGate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const pending = service.lookup("test");
  await new Promise((resolve) => setTimeout(resolve, 5));
  service.reset();
  statGate = undefined;
  unblock();
  await assert.rejects(pending, /取消/u);
  const beforeConcurrent = parses;
  const concurrent = await Promise.all([
    service.lookup("test"),
    service.lookup("test"),
  ]);
  assert.equal(concurrent[0].entries.length, 1);
  assert.equal(concurrent[1].entries.length, 1);
  assert.equal(
    parses,
    beforeConcurrent + 1,
    "concurrent lookup must share the initialized dictionary and entry cache",
  );
  assert.equal(errors.length, 0);
  console.log(
    "dictionary service: incremental results, zero MDD I/O, deferred split-MDD audio, caches, invalidation and reset races passed",
  );
} finally {
  service.reset();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await rm(directory, { recursive: true, force: true });
}
