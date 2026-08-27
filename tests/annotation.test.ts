import assert from "node:assert/strict";
import { saveTranslationAnnotation } from "../src/annotation";

let savedJSON: Record<string, unknown> | undefined;
let readerUpdate: unknown[] | undefined;
const savedItem = { id: 99 };

(globalThis as typeof globalThis & { Zotero: unknown }).Zotero = {
  Items: {
    get: (id: number) => (id === 42 ? { id, libraryID: 1 } : null),
  },
  DataObjectUtilities: {
    generateKey: () => "ABCDEFGH",
  },
  Annotations: {
    DEFAULT_COLOR: "#ffd400",
    saveFromJSON: async (
      _attachment: unknown,
      json: Record<string, unknown>,
    ) => {
      savedJSON = json;
      return savedItem;
    },
  },
};

const reader = {
  itemID: 42,
  setAnnotations: (items: unknown[]) => {
    readerUpdate = items;
  },
};

await saveTranslationAnnotation(
  {
    reader: reader as never,
    selection: {
      text: "selected source text",
      color: "#ff6666",
      pageLabel: "3",
      sortIndex: "00002|000001|00000",
      position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
    } as never,
  },
  "翻译结果",
);

assert.equal(savedJSON?.key, "ABCDEFGH");
assert.equal(savedJSON?.type, "highlight");
assert.equal(savedJSON?.text, "selected source text");
assert.equal(savedJSON?.comment, "翻译结果");
assert.deepEqual(savedJSON?.position, {
  pageIndex: 2,
  rects: [[1, 2, 3, 4]],
});
assert.deepEqual(readerUpdate, [savedItem]);

console.log("annotation save mock: passed");
