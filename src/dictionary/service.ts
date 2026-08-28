import {
  getPref,
  loadDictionaryConfigs,
  type DictionaryConfig,
} from "../prefs";
import {
  openResourceDictionary,
  openTextDictionary,
  type ResourceDictionaryReader,
  type TextDictionaryReader,
} from "./mdict-reader";
import { discoverSiblingMDDPaths, groupDictionaryPaths } from "./paths";
import { parseDefinition, type ParsedDefinition } from "./parser";
import type {
  AudioAsset,
  AudioReference,
  DictionaryEntry,
  LocalLookupOptions,
  LocalLookupResult,
} from "./types";

const LINK_PREFIX = "@@@LINK=";
const MAX_AUDIO_ITEMS_PER_DICTIONARY = 4;
const MAX_QUERY_CACHE_ITEMS = 96;
const MAX_AUDIO_CACHE_ITEMS = 12;

interface CachedEntry {
  headword: string;
  parsed: ParsedDefinition;
}

interface LoadedDictionary {
  mdxPath: string;
  mdx: TextDictionaryReader;
  configuredMDDPaths: string[];
  mdds: Map<string, Promise<ResourceDictionaryReader | null>>;
  queryCache: Map<string, CachedEntry | null>;
  audioCache: Map<string, Promise<string | null>>;
  audioGeneration: number;
  disposed: boolean;
}

interface DictionarySlot {
  active: boolean;
  signature: string;
  loaded?: LoadedDictionary;
  pending: Promise<LoadedDictionary>;
}

function lookupCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const plain = trimmed.replace(/^[\p{P}\p{Z}]+|[\p{P}\p{Z}]+$/gu, "");
  return [
    trimmed,
    plain,
    plain.toLocaleLowerCase(),
    plain.toLocaleUpperCase(),
    plain ? plain.charAt(0).toLocaleUpperCase() + plain.slice(1) : "",
  ].filter((value, index, all) => value && all.indexOf(value) === index);
}

function resolveDefinition(
  mdx: TextDictionaryReader,
  query: string,
  followedLinks = new Set<string>(),
): { definition: string; headword: string } | null {
  for (const candidate of lookupCandidates(query)) {
    const result = mdx.lookup(candidate);
    if (!result.definition) continue;
    const normalized = result.definition.trimStart();
    if (!normalized.startsWith(LINK_PREFIX)) {
      return {
        definition: result.definition,
        headword: result.keyText || candidate,
      };
    }
    const target = normalized.slice(LINK_PREFIX.length).trim();
    const key = target.toLocaleLowerCase();
    if (!target || followedLinks.has(key) || followedLinks.size >= 8)
      return null;
    followedLinks.add(key);
    return resolveDefinition(mdx, target, followedLinks);
  }
  return null;
}

function audioMimeType(resource: string): string {
  const extension = resource.split(".").pop()?.toLocaleLowerCase() || "";
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    spx: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
  };
  return types[extension] || "application/octet-stream";
}

function resourceCandidates(resource: string): string[] {
  const normalized = resource.replace(/^[/\\]+/u, "");
  const windows = normalized.replace(/\//gu, "\\");
  const unix = normalized.replace(/\\/gu, "/");
  return [normalized, windows, unix, `\\${windows}`, `/${unix}`].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
}

function trimMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) map.delete(map.keys().next().value as K);
}

function normalizedPath(path: string): string {
  return path.replace(/\\/gu, "/").toLocaleLowerCase();
}

async function fileSignature(path: string): Promise<string> {
  const stat = await IOUtils.stat(path);
  return `${path}\u0000${stat.size}\u0000${stat.lastModified}`;
}

export class LocalDictionaryService {
  private readonly slots = new Map<string, DictionarySlot>();
  private epoch = 0;
  private configurationSignature = "";

  reset(): void {
    this.epoch += 1;
    for (const slot of this.slots.values()) {
      slot.active = false;
      if (slot.loaded) this.closeLoaded(slot.loaded);
    }
    this.slots.clear();
  }

  /** Keep unchanged MDX indexes when a dictionary is renamed or added. */
  configurationChanged(): void {
    const configs = loadDictionaryConfigs().filter((item) => item.enabled);
    const signature = JSON.stringify(configs);
    if (signature !== this.configurationSignature) {
      this.epoch += 1;
      this.configurationSignature = signature;
    }
    const configured = new Map(
      configs.map((item) => [normalizedPath(item.mdxPath), item]),
    );
    for (const [path, slot] of this.slots) {
      const config = configured.get(path);
      if (config) {
        if (slot.loaded) this.updateResourcePaths(slot.loaded, config.mddPaths);
        continue;
      }
      slot.active = false;
      if (slot.loaded) this.closeLoaded(slot.loaded);
      this.slots.delete(path);
    }
  }

  releaseAudio(): void {
    for (const slot of this.slots.values()) {
      if (slot.loaded) this.closeAudio(slot.loaded);
    }
  }

  private closeAudio(dictionary: LoadedDictionary): void {
    dictionary.audioGeneration += 1;
    for (const pending of dictionary.mdds.values()) {
      void pending.then((mdd) => mdd?.close()).catch(() => {});
    }
    dictionary.mdds.clear();
    dictionary.audioCache.clear();
  }

  private closeLoaded(dictionary: LoadedDictionary): void {
    if (dictionary.disposed) return;
    dictionary.disposed = true;
    this.closeAudio(dictionary);
    dictionary.mdx.close();
    dictionary.queryCache.clear();
  }

  private async getDictionary(
    config: DictionaryConfig,
    onIndexProgress?: (completed: number, total: number) => void,
  ): Promise<LoadedDictionary> {
    const epoch = this.epoch;
    if (!(await IOUtils.exists(config.mdxPath))) {
      throw new Error(`文件不存在：${config.mdxPath}`);
    }
    const signature = await fileSignature(config.mdxPath);
    if (epoch !== this.epoch) throw new Error("词典加载已取消");
    const key = normalizedPath(config.mdxPath);
    const existing = this.slots.get(key);
    if (existing?.active && existing.signature === signature) {
      const loaded = await existing.pending;
      this.updateResourcePaths(loaded, config.mddPaths);
      return loaded;
    }
    if (existing) {
      existing.active = false;
      if (existing.loaded) this.closeLoaded(existing.loaded);
    }

    const slot = { active: true, signature } as DictionarySlot;
    slot.pending = openTextDictionary(config.mdxPath, {
      onProgress: onIndexProgress,
      isCancelled: () => !slot.active,
    }).then((mdx) => {
      if (!slot.active) {
        mdx.close();
        throw new Error("词典加载已取消");
      }
      const loaded: LoadedDictionary = {
        mdxPath: config.mdxPath,
        mdx,
        configuredMDDPaths: [...config.mddPaths],
        mdds: new Map(),
        queryCache: new Map(),
        audioCache: new Map(),
        audioGeneration: 0,
        disposed: false,
      };
      slot.loaded = loaded;
      return loaded;
    });
    this.slots.set(key, slot);
    try {
      return await slot.pending;
    } catch (error) {
      if (this.slots.get(key) === slot) this.slots.delete(key);
      throw error;
    }
  }

  private updateResourcePaths(
    dictionary: LoadedDictionary,
    paths: string[],
  ): void {
    const before = dictionary.configuredMDDPaths.map(normalizedPath).join("\n");
    const after = paths.map(normalizedPath).join("\n");
    if (before === after) return;
    this.closeAudio(dictionary);
    dictionary.configuredMDDPaths = [...paths];
  }

  private cachedEntry(
    dictionary: LoadedDictionary,
    word: string,
    includeAudio: boolean,
  ): CachedEntry | null {
    const key = `${includeAudio ? "audio" : "text"}\u0000${word.trim()}`;
    if (dictionary.queryCache.has(key)) {
      const value = dictionary.queryCache.get(key) ?? null;
      dictionary.queryCache.delete(key);
      dictionary.queryCache.set(key, value);
      return value;
    }
    const matched = resolveDefinition(dictionary.mdx, word);
    const value = matched
      ? {
          headword: matched.headword,
          parsed: parseDefinition(matched.definition, matched.headword, {
            includeAudio,
          }),
        }
      : null;
    dictionary.queryCache.set(key, value);
    trimMap(dictionary.queryCache, MAX_QUERY_CACHE_ITEMS);
    return value;
  }

  private async resourcePaths(dictionary: LoadedDictionary): Promise<string[]> {
    const expanded = await discoverSiblingMDDPaths([
      dictionary.mdxPath,
      ...dictionary.configuredMDDPaths,
    ]);
    return (
      groupDictionaryPaths(expanded).find(
        (item) =>
          normalizedPath(item.mdxPath) === normalizedPath(dictionary.mdxPath),
      )?.mddPaths || []
    );
  }

  private async getMDD(
    dictionary: LoadedDictionary,
    path: string,
    generation: number,
  ): Promise<ResourceDictionaryReader | null> {
    const existing = dictionary.mdds.get(path);
    if (existing) return existing;
    const pending = openResourceDictionary(path, {
      isCancelled: () =>
        generation !== dictionary.audioGeneration ||
        !getPref("loadDictionaryAudio"),
    })
      .then((mdd) => {
        if (
          generation !== dictionary.audioGeneration ||
          !getPref("loadDictionaryAudio")
        ) {
          mdd.close();
          return null;
        }
        return mdd;
      })
      .catch((error) => {
        if (
          generation === dictionary.audioGeneration &&
          getPref("loadDictionaryAudio")
        ) {
          Zotero.logError(error as Error);
        }
        return null;
      });
    dictionary.mdds.set(path, pending);
    const mdd = await pending;
    if (!mdd && dictionary.mdds.get(path) === pending)
      dictionary.mdds.delete(path);
    return mdd;
  }

  private audioLoader(
    dictionary: LoadedDictionary,
    reference: AudioReference,
  ): () => Promise<string> {
    return async () => {
      if (!getPref("loadDictionaryAudio"))
        throw new Error("词典发音已在设置中关闭");
      if (dictionary.disposed)
        throw new Error("词典配置已改变，请重新查词后播放");
      const generation = dictionary.audioGeneration;
      const cacheKey = `${reference.resource}\u0000${generation}`;
      let pending = dictionary.audioCache.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          for (const path of await this.resourcePaths(dictionary)) {
            if (
              generation !== dictionary.audioGeneration ||
              !getPref("loadDictionaryAudio")
            )
              return null;
            if (!(await IOUtils.exists(path))) continue;
            const mdd = await this.getMDD(dictionary, path, generation);
            if (!mdd) continue;
            for (const candidate of resourceCandidates(reference.resource)) {
              try {
                const base64 = mdd.locate(candidate).definition;
                if (base64)
                  return `data:${audioMimeType(reference.resource)};base64,${base64}`;
              } catch {
                // The resource may be in a numbered MDD part.
              }
            }
          }
          return null;
        })();
        dictionary.audioCache.set(cacheKey, pending);
        trimMap(dictionary.audioCache, MAX_AUDIO_CACHE_ITEMS);
      }
      try {
        const url = await pending;
        if (
          generation !== dictionary.audioGeneration ||
          !getPref("loadDictionaryAudio")
        ) {
          throw new Error("发音加载已取消");
        }
        if (!url)
          throw new Error(`词典中未找到发音资源：${reference.resource}`);
        return url;
      } catch (error) {
        if (dictionary.audioCache.get(cacheKey) === pending)
          dictionary.audioCache.delete(cacheKey);
        throw error;
      }
    };
  }

  async lookup(
    word: string,
    options: LocalLookupOptions = {},
  ): Promise<LocalLookupResult> {
    this.configurationChanged();
    const epoch = this.epoch;
    const configs = loadDictionaryConfigs().filter((config) => config.enabled);
    const entries: DictionaryEntry[] = [];
    const errors: string[] = [];
    const result = (): LocalLookupResult => ({
      word: word.trim(),
      entries: [...entries],
      errors: [...errors],
      configuredDictionaries: configs.length,
    });
    const cancelled = () => epoch !== this.epoch || options.isCancelled?.();
    const emit = (completed: number, message: string) => {
      if (!cancelled())
        options.onProgress?.({
          result: result(),
          completed,
          total: configs.length,
          message,
        });
    };
    if (configs.length === 0) {
      errors.push("尚未配置或启用任何 MDX 词典");
      return result();
    }
    const includeAudio = getPref("loadDictionaryAudio");
    for (let index = 0; index < configs.length; index++) {
      if (cancelled()) throw new Error("本地词典查询已取消");
      const config = configs[index];
      emit(index, `正在打开 ${config.name}…`);
      try {
        const dictionary = await this.getDictionary(config, (done, total) => {
          const percent = total ? Math.round((done / total) * 100) : 100;
          emit(index, `${config.name} · 建立索引 ${percent}%`);
        });
        if (cancelled()) throw new Error("本地词典查询已取消");
        const cached = this.cachedEntry(dictionary, word, includeAudio);
        if (cached) {
          const audio: AudioAsset[] = cached.parsed.audioReferences
            .slice(0, MAX_AUDIO_ITEMS_PER_DICTIONARY)
            .map((reference) => ({
              label: reference.label,
              region: reference.region,
              load: this.audioLoader(dictionary, reference),
            }));
          entries.push({
            source: config.name,
            headword: cached.headword,
            pronunciations: cached.parsed.pronunciations,
            senses: cached.parsed.senses,
            forms: cached.parsed.forms,
            tags: cached.parsed.tags,
            audio,
          });
        }
      } catch (error) {
        if (cancelled()) throw error;
        errors.push(`${config.name} 查询失败：${String(error)}`);
        Zotero.logError(error as Error);
      }
      emit(index + 1, `${config.name} 查询完成`);
      await Zotero.Promise.delay(0);
    }
    if (cancelled()) throw new Error("本地词典查询已取消");
    return result();
  }
}
