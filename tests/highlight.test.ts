import assert from "node:assert/strict";
import { splitQueryHighlights } from "../src/ui/highlight";

function highlighted(text: string, words: string[]) {
  const parts = splitQueryHighlights(text, words);
  assert.equal(parts.map((part) => part.text).join(""), text);
  return parts.filter((part) => part.highlighted).map((part) => part.text);
}
assert.deepEqual(
  highlighted("A BANK and bank; a banker or banking.", ["bank"]),
  ["BANK", "bank"],
);
assert.deepEqual(
  highlighted("research, researches, researched, researching, researcher", [
    "research",
    "researches",
    "researched",
    "researching",
  ]),
  ["research", "researches", "researched", "researching"],
);
assert.deepEqual(highlighted("can't can candy can-do", ["can", "can't"]), [
  "can't",
  "can",
]);
assert.deepEqual(
  highlighted("Take-off; take-offer; retake-off", ["take-off"]),
  ["Take-off"],
);
assert.deepEqual(highlighted("A naïve NAÏVE approach, naïveté", ["naïve"]), [
  "naïve",
  "NAÏVE",
]);
assert.deepEqual(highlighted("🧪test test🧪 re-test test_case", ["test"]), [
  "test",
  "test",
]);
assert.deepEqual(highlighted("研究成果与研究人员", ["研究"]), ["研究", "研究"]);
assert.deepEqual(
  highlighted("A sample, another SAMPLE.", ["“sample”", "sample"]),
  ["sample", "SAMPLE"],
);
assert.deepEqual(
  highlighted("A complete sentence.", ["A complete sentence."]),
  [],
);
assert.deepEqual(
  highlighted("<img onerror=alert(1)>sample</img>", ["sample"]),
  ["sample"],
);
assert.deepEqual(highlighted("No changes", []), []);
console.log(
  "Query highlights: exact words, case, source forms, Unicode and unchanged text passed",
);
