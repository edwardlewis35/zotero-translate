import assert from "node:assert/strict";
import {
  saveTranslationAnnotation,
  snapshotTranslationSelection,
} from "../src/annotation";

interface MockAnnotation {
  id: string;
  key: string;
  text: string;
  comment: string;
  position: { pageIndex: number; rects: number[][] };
  [key: string]: unknown;
}

const savedJSON: MockAnnotation[] = [];
const savedOptions: Array<Record<string, unknown>> = [];
const readerUpdates: unknown[][] = [];
let queueCommits = 0;
let keyIndex = 0;
let loggedErrors = 0;
let positionMaxSize = 65_000;
let failReaderRefresh = false;

class MockQueue {}

const attachment = {
  id: 42,
  libraryID: 1,
  isEditable: () => true,
};

(globalThis as typeof globalThis & { Zotero: unknown }).Zotero = {
  Items: {
    get: (id: number) => (id === attachment.id ? attachment : null),
  },
  DataObjectUtilities: {
    generateKey: () => `KEY${String(++keyIndex).padStart(5, "0")}`,
  },
  Annotations: {
    DEFAULT_COLOR: "#ffd400",
    get ANNOTATION_POSITION_MAX_SIZE() {
      return positionMaxSize;
    },
    splitAnnotationJSON: (json: MockAnnotation) => {
      const midpoint = Math.ceil(json.position.rects.length / 2);
      return [
        {
          ...json,
          key: "SPLIT001",
          position: {
            ...json.position,
            rects: json.position.rects.slice(0, midpoint),
          },
        },
        {
          ...json,
          key: "SPLIT002",
          position: {
            ...json.position,
            rects: json.position.rects.slice(midpoint),
          },
        },
      ];
    },
    saveFromJSON: async (
      _attachment: unknown,
      json: MockAnnotation,
      options: Record<string, unknown>,
    ) => {
      savedJSON.push(json);
      savedOptions.push(options);
      return { id: savedJSON.length, key: json.key };
    },
  },
  Notifier: {
    Queue: MockQueue,
    commit: async (queue: unknown) => {
      assert.ok(queue instanceof MockQueue);
      queueCommits += 1;
    },
  },
  logError: () => {
    loggedErrors += 1;
  },
};

const reader = {
  itemID: 42,
  _instanceID: "reader-instance-1",
  setAnnotations: (items: unknown[]) => {
    if (failReaderRefresh) throw new Error("mock reader refresh failure");
    readerUpdates.push(items);
  },
};

function reset(): void {
  savedJSON.length = 0;
  savedOptions.length = 0;
  readerUpdates.length = 0;
  queueCommits = 0;
  loggedErrors = 0;
  positionMaxSize = 65_000;
  failReaderRefresh = false;
}

// The reader-owned event object is copied before a delayed LLM response. A
// later popup mutation must not change the annotation that is persisted.
reset();
const liveSelection = {
  text: "selected source text",
  color: "#ff6666",
  pageLabel: "3",
  sortIndex: "00002|000001|00000",
  position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
};
const snapshot = snapshotTranslationSelection(liveSelection as never);
liveSelection.text = "mutated after popup closed";
liveSelection.position.rects[0][0] = 999;

const normalItems = await saveTranslationAnnotation(
  {
    reader: reader as never,
    attachmentItemID: 42,
    selection: snapshot,
  },
  "翻译结果",
);

assert.equal(normalItems.length, 1);
assert.equal(savedJSON[0].text, "selected source text");
assert.equal(savedJSON[0].comment, "翻译结果");
assert.deepEqual(savedJSON[0].position, {
  pageIndex: 2,
  rects: [[1, 2, 3, 4]],
});
assert.deepEqual(
  (savedOptions[0].notifierData as Record<string, unknown>).instanceID,
  "reader-instance-1",
);
assert.equal(queueCommits, 1);
assert.equal(readerUpdates.length, 1);

// A long PDF selection can exceed Zotero's per-annotation position limit even
// when the translation itself is short. It must be split into valid adjacent
// highlights, with the translation retained on every chunk.
reset();
positionMaxSize = 10;
const longRects = Array.from({ length: 20 }, (_, index) => [
  index,
  index + 1,
  index + 2,
  index + 3,
]);
const splitItems = await saveTranslationAnnotation(
  {
    reader: reader as never,
    attachmentItemID: 42,
    selection: {
      text: "a long selected passage",
      color: "#ffd400",
      pageLabel: "8",
      sortIndex: "00007|000001|00000",
      position: { pageIndex: 7, rects: longRects },
    } as never,
  },
  "长段落翻译",
);

assert.equal(splitItems.length, 2);
assert.deepEqual(
  savedJSON.map(({ id, key }) => ({ id, key })),
  [
    { id: "SPLIT001", key: "SPLIT001" },
    { id: "SPLIT002", key: "SPLIT002" },
  ],
);
assert.deepEqual(
  savedJSON.map(({ comment }) => comment),
  ["长段落翻译", "长段落翻译"],
);
assert.equal(
  savedJSON.reduce((count, json) => count + json.position.rects.length, 0),
  longRects.length,
);
assert.equal(readerUpdates[0].length, 2);
assert.equal(queueCommits, 1);

// Once the database save succeeds, an optional immediate reader refresh error
// is logged but must not reject the operation and prompt a duplicate retry.
reset();
failReaderRefresh = true;
await saveTranslationAnnotation(
  {
    reader: reader as never,
    attachmentItemID: 42,
    selection: snapshot,
  },
  "已保存的翻译",
);
assert.equal(savedJSON.length, 1);
assert.equal(loggedErrors, 1);
assert.equal(queueCommits, 1);

console.log("annotation save, long-selection split, and refresh tests: passed");
