import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MDX } from "js-mdict";
import {
  openTextDictionary,
  openResourceDictionary,
} from "../src/dictionary/mdict-reader";
import { mdictFixture } from "./helpers/mdict-fixture";

const directory = await mkdtemp(path.join(tmpdir(), "lexiflow-mdict-"));
let yields = 0;
Object.assign(globalThis, {
  Zotero: {
    Promise: {
      delay: async () => {
        yields++;
      },
    },
  },
});
try {
  // Deliberately unordered, with mixed case, Unicode and block-end records.
  const entries: Array<[string, string]> = [
    ["zebra", "斑马"],
    ["Apple", "苹果"],
    ["apple", "小写苹果"],
    ["你好", "hello"],
    ["e\u0301lan", "劲头"],
    ["a-b", "连字符"],
    ["a b", "空格"],
    ["last", "最后一个词条的完整内容"],
  ];
  for (const compressed of [true, false]) {
    const file = path.join(directory, `${compressed}.mdx`);
    await writeFile(file, mdictFixture(entries, { compressed }));
    const progress: number[] = [];
    const optimized = await openTextDictionary(file, {
      onProgress: (done) => progress.push(done),
    });
    const reference = new MDX(file);
    try {
      for (const [word, definition] of entries) {
        assert.equal(optimized.lookup(word).definition, definition);
        assert.equal(
          optimized.lookup(word).definition,
          reference.lookup(word).definition,
        );
      }
      assert.equal(optimized.lookup("élan").definition, "劲头");
      assert.equal(optimized.lookup("missing").definition, null);
      assert.equal(progress[0], 0);
      assert.equal(progress.at(-1), entries.length);
    } finally {
      optimized.close();
      reference.close();
    }
  }

  const audioPath = path.join(directory, "audio.mdd");
  const audio = Buffer.from([0, 10, 255, 3, 0, 77, 81]);
  await writeFile(
    audioPath,
    mdictFixture(
      [
        ["\\uk\\word.mp3", Buffer.from("one")],
        ["\\us\\word.mp3", Buffer.from("two")],
        ["\\最后.wav", audio],
      ],
      { mdd: true, blockSize: 1 },
    ),
  );
  const mdd = await openResourceDictionary(audioPath);
  try {
    assert.equal(
      mdd.locate("/uk/word.mp3").definition,
      Buffer.from("one").toString("base64"),
    );
    assert.equal(
      mdd.locate("/us/word.mp3").definition,
      Buffer.from("two").toString("base64"),
    );
    assert.equal(mdd.locate("最后.wav").definition, audio.toString("base64"));
  } finally {
    mdd.close();
  }

  const emptyPath = path.join(directory, "empty.mdx");
  await writeFile(emptyPath, mdictFixture([]));
  const empty = await openTextDictionary(emptyPath);
  assert.equal(empty.lookup("anything").definition, null);
  empty.close();

  const largePath = path.join(directory, "many-blocks.mdx");
  const many: Array<[string, string]> = Array.from({ length: 70 }, (_, i) => [
    `word${i}`,
    `definition${i}`,
  ]);
  await writeFile(largePath, mdictFixture(many, { blockSize: 1 }));
  const before = yields;
  const large = await openTextDictionary(largePath);
  assert.ok(
    yields - before >= 5,
    "batching must yield while reading key blocks",
  );
  assert.equal(large.lookup("word69").definition, "definition69");
  large.close();
  let cancelled = false;
  await assert.rejects(
    openTextDictionary(largePath, {
      isCancelled: () => cancelled,
      onProgress: (done) => {
        if (done >= 16) cancelled = true;
      },
    }),
    /已取消/u,
  );
  const recovered = await openTextDictionary(largePath);
  assert.equal(recovered.lookup("word1").definition, "definition1");
  recovered.close();
  console.log(
    "batched MDX/MDD indexes: real compressed/raw fixtures, Unicode, block boundaries and cancellation passed",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
