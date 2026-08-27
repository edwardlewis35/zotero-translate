import assert from "node:assert/strict";
import { extractPronunciationText } from "../src/dictionary/parser";

assert.equal(extractPronunciationText("test"), "");
assert.equal(extractPronunciationText("英 test"), "");
assert.equal(extractPronunciationText("美：traffic"), "");
assert.equal(extractPronunciationText("英 /ˈtræfɪk/"), "/ˈtræfɪk/");
assert.equal(extractPronunciationText("US [ˈtræfɪk]"), "[ˈtræfɪk]");
assert.equal(extractPronunciationText("UK təˈmɑːtəʊ"), "təˈmɑːtəʊ");

console.log("phonetic extraction rejects headword fallback: passed");
