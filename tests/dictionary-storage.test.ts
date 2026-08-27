import assert from "node:assert/strict";
import {
  getManagedDictionaryDirectory,
  importDictionaryFiles,
} from "../src/dictionary/storage";

const copied: Array<[string, string]> = [];
const directories: string[] = [];

Object.assign(globalThis, {
  Zotero: { DataDirectory: { dir: "/zotero-data" } },
  PathUtils: {
    join: (...parts: string[]) => parts.join("/").replace(/\/{2,}/gu, "/"),
    normalize: (path: string) => path.replace(/\\/gu, "/"),
  },
  IOUtils: {
    exists: async () => true,
    getChildren: async (directory: string) => [
      `${directory}/Oxford.mdx`,
      `${directory}/Oxford.mdd`,
      `${directory}/Oxford.1.mdd`,
      `${directory}/Unrelated.mdd`,
    ],
    makeDirectory: async (directory: string) => {
      directories.push(directory);
    },
    copy: async (source: string, destination: string) => {
      copied.push([source, destination]);
    },
  },
});

const imported = await importDictionaryFiles(["/source/Oxford.mdx"]);

assert.equal(
  getManagedDictionaryDirectory(),
  "/zotero-data/lexiflow-dict-translator/dictionaries",
);
assert.equal(imported.length, 3);
assert.deepEqual(copied.map(([source]) => source).sort(), [
  "/source/Oxford.1.mdd",
  "/source/Oxford.mdd",
  "/source/Oxford.mdx",
]);
assert.ok(
  copied.every(([, destination]) =>
    destination.startsWith(
      "/zotero-data/lexiflow-dict-translator/dictionaries/source-",
    ),
  ),
);
assert.ok(directories.length >= 2);

console.log("managed dictionary import mock: passed");
