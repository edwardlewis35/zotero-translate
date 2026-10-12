import assert from "node:assert/strict";
import { isSingleWord, normalizeSelectedWord } from "../src/selection";

for (const text of [
  "bank",
  " bank. ",
  "“research”",
  "(hello)",
  "co\u00adoperate",
  "nai\u0308ve",
  "mother-in-law",
  "self\u2010aware",
  "self\u2011aware",
  "don't",
  "l’été",
  "maʼam",
  "COVID-19",
  "RNA2",
  "3D",
  "5G",
  "α",
  "Ελλάδα",
  "банк",
  "مرحبا",
  "은행",
  "银行",
  "研究",
]) {
  assert.equal(isSingleWord(text), true, `word selection: ${text}`);
}

for (const text of [
  "",
  "…",
  "42",
  "hello world",
  "hello\nworld",
  "New\u00a0York",
  "This is a sentence.",
  "hello.World",
  "example.com",
  "https://example.com",
  "a@example.com",
  "and/or",
  "a+b",
  "foo--bar",
  "foo''bar",
  "foo\u200bbar",
  "这是一个句子",
  "私の名前は太郎です",
  "a".repeat(81),
]) {
  assert.equal(isSingleWord(text), false, `translation selection: ${text}`);
}
assert.equal(normalizeSelectedWord(" “nai\u0308ve\u00ad.” "), "naïve");
assert.equal(normalizeSelectedWord("hello world"), "hello world");

// A missing or failing host segmenter must not turn a Chinese sentence into a word.
const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
try {
  Object.defineProperty(Intl, "Segmenter", {
    configurable: true,
    value: undefined,
  });
  assert.equal(isSingleWord("字"), true);
  assert.equal(isSingleWord("这是一个句子"), false);
  assert.equal(isSingleWord("mother-in-law"), true);
  Object.defineProperty(Intl, "Segmenter", {
    configurable: true,
    value: class {
      constructor() {
        throw new Error("host segmentation unavailable");
      }
    },
  });
  assert.equal(isSingleWord("这是一个句子"), false);
} finally {
  Object.defineProperty(Intl, "Segmenter", descriptor);
}

console.log(
  "Selection mode: Unicode words, punctuation, soft hyphens, compounds and sentence boundaries passed",
);
