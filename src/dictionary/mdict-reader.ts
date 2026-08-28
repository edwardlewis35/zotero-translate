import { MDD, MDX, type KeyWordItem } from "js-mdict";

export interface IndexLoadOptions {
  onProgress?: (completed: number, total: number) => void;
  isCancelled?: () => boolean;
}

export type TextDictionaryReader = Pick<MDX, "lookup" | "close">;
export type ResourceDictionaryReader = Pick<MDD, "locate" | "close">;

// js-mdict 7.0.0 eagerly concatenates and sorts the complete keyword list in
// its constructor. Only exact lookup is needed here. Defer that work, scan
// each key block once, and use a Map without assuming the MDX's sort order.
// Do not use the inherited fuzzy/prefix APIs: keywordList is intentionally empty.
class IndexedMDX extends MDX {
  readonly wordIndex = new Map<string, KeyWordItem>();
  override readDict(): void {}
  override lookupKeyBlockByWord(word: string): KeyWordItem | undefined {
    return this.wordIndex.get(word.normalize("NFC"));
  }
}

class IndexedMDD extends MDD {
  readonly wordIndex = new Map<string, KeyWordItem>();
  override readDict(): void {}
  override lookupKeyBlockByWord(word: string): KeyWordItem | undefined {
    return this.wordIndex.get(word.normalize("NFC"));
  }
}

// These are TypeScript-private, ordinary JS methods in the pinned dependency.
// Keep the adaptation in this file and exercise it with real MDX/MDD fixtures.
interface MetadataReader {
  _readHeader(): void;
  _readKeyHeader(): void;
  _readKeyInfos(): void;
  _readRecordHeader(): void;
  _readRecordInfos(): void;
  _keyBlockInfoEndOffset: number;
  _keyBlockStartOffset: number;
  _keyBlockEndOffset: number;
}

async function initialize<T extends IndexedMDX | IndexedMDD>(
  dictionary: T,
  options: IndexLoadOptions,
): Promise<T> {
  const checkCancelled = () => {
    if (options.isCancelled?.()) throw new Error("词典加载已取消");
  };
  try {
    checkCancelled();
    const metadata = dictionary as unknown as MetadataReader;
    for (const method of [
      "_readHeader",
      "_readKeyHeader",
      "_readKeyInfos",
      "_readRecordHeader",
      "_readRecordInfos",
    ] as const) {
      if (typeof metadata[method] !== "function") {
        throw new Error("词典索引适配器需要 js-mdict 7.0.0");
      }
      metadata[method]();
    }
    metadata._keyBlockStartOffset = metadata._keyBlockInfoEndOffset;
    metadata._keyBlockEndOffset =
      metadata._keyBlockStartOffset +
      dictionary.keyHeader.keywordBlockPackedSize;

    let previous: KeyWordItem | undefined;
    let completed = 0;
    let lastYield = Date.now();
    const total = dictionary.keyHeader.keywordNum;
    options.onProgress?.(0, total);
    // Even a small dictionary lets the first loading state paint before I/O.
    await Zotero.Promise.delay(0);
    for (let block = 0; block < dictionary.keyInfoList.length; block++) {
      checkCancelled();
      const entries = dictionary.lookupPartialKeyBlockListByKeyInfoId(block);
      if (previous && entries.length) {
        previous.recordEndOffset = entries[0].recordStartOffset;
      }
      for (const entry of entries) {
        const key = entry.keyText.normalize("NFC");
        if (!dictionary.wordIndex.has(key))
          dictionary.wordIndex.set(key, entry);
      }
      previous = entries.at(-1) || previous;
      completed += entries.length;
      if (Date.now() - lastYield >= 8 || block % 16 === 15) {
        options.onProgress?.(completed, total);
        await Zotero.Promise.delay(0);
        lastYield = Date.now();
      }
    }
    checkCancelled();
    if (completed !== total)
      throw new Error("词典索引不完整，请检查 MDX/MDD 文件");
    const lastRecord = dictionary.recordInfoList.at(-1);
    if (previous && lastRecord) {
      previous.recordEndOffset =
        lastRecord.unpackAccumulatorOffset + lastRecord.unpackSize;
    }
    options.onProgress?.(completed, total);
    return dictionary;
  } catch (error) {
    dictionary.close();
    throw error;
  }
}

export async function openTextDictionary(
  path: string,
  options: IndexLoadOptions = {},
): Promise<TextDictionaryReader> {
  return initialize(new IndexedMDX(path), options);
}

export async function openResourceDictionary(
  path: string,
  options: IndexLoadOptions = {},
): Promise<ResourceDictionaryReader> {
  return initialize(new IndexedMDD(path), options);
}
