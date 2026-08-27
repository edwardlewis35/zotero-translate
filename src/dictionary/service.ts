import { MDD, MDX } from "js-mdict";
import { loadDictionaryConfigs, type DictionaryConfig } from "../prefs";
import {
  discoverSiblingMDDPaths,
  groupDictionaryPaths,
  type DictionaryFileGroup,
} from "./paths";
import { extractAudioReferences, parseDefinition } from "./parser";
import type {
  AudioAsset,
  AudioReference,
  DictionaryEntry,
  LocalLookupResult,
} from "./types";

const LINK_PREFIX = "@@@LINK=";
const MAX_AUDIO_ITEMS_PER_DICTIONARY = 4;

interface LoadedDictionary extends DictionaryFileGroup {
  mdx: MDX;
  mdds: Map<string, MDD | null>;
}

interface DictionaryLoadResult {
  dictionaries: LoadedDictionary[];
  errors: string[];
}

function lookupCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const withoutOuterPunctuation = trimmed.replace(
    /^[\p{P}\p{Z}]+|[\p{P}\p{Z}]+$/gu,
    "",
  );
  const candidates = [
    trimmed,
    withoutOuterPunctuation,
    withoutOuterPunctuation.toLocaleLowerCase(),
    withoutOuterPunctuation.toLocaleUpperCase(),
    withoutOuterPunctuation
      ? withoutOuterPunctuation.charAt(0).toLocaleUpperCase() +
        withoutOuterPunctuation.slice(1)
      : "",
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function resolveDefinition(
  mdx: MDX,
  query: string,
  followedLinks = new Set<string>(),
): { definition: string; headword: string } | null {
  for (const candidate of lookupCandidates(query)) {
    const result = mdx.lookup(candidate);
    const definition = result.definition;
    if (!definition) continue;
    const normalized = definition.trimStart();
    if (!normalized.startsWith(LINK_PREFIX)) {
      return {
        definition,
        headword: result.keyText || candidate,
      };
    }
    const target = normalized.slice(LINK_PREFIX.length).trim();
    const key = target.toLocaleLowerCase();
    if (!target || followedLinks.has(key) || followedLinks.size >= 8) {
      return null;
    }
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

async function getMDD(
  dictionary: LoadedDictionary,
  path: string,
): Promise<MDD | null> {
  if (dictionary.mdds.has(path)) {
    return dictionary.mdds.get(path) || null;
  }
  try {
    await Zotero.Promise.delay(0);
    const mdd = new MDD(path, {
      passcode: "",
      isStripKey: true,
      isCaseSensitive: false,
      resort: true,
    });
    dictionary.mdds.set(path, mdd);
    return mdd;
  } catch (error) {
    Zotero.logError(error as Error);
    dictionary.mdds.set(path, null);
    return null;
  }
}

function resourceCandidates(resource: string): string[] {
  const normalized = resource.replace(/^[/\\]+/u, "");
  const windows = normalized.replace(/\//gu, "\\");
  const unix = normalized.replace(/\\/gu, "/");
  return [normalized, windows, unix, `\\${windows}`, `/${unix}`].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
}

async function lookupAudioReference(
  dictionary: LoadedDictionary,
  reference: AudioReference,
): Promise<AudioAsset | null> {
  for (const path of dictionary.mddPaths) {
    const mdd = await getMDD(dictionary, path);
    if (!mdd) continue;
    for (const candidate of resourceCandidates(reference.resource)) {
      try {
        const base64 = mdd.locate(candidate).definition;
        if (!base64) continue;
        return {
          label: reference.label,
          region: reference.region,
          url: `data:${audioMimeType(reference.resource)};base64,${base64}`,
        };
      } catch {
        // The resource can be in another numbered MDD part.
      }
    }
  }
  return null;
}

export class LocalDictionaryService {
  private cacheKey: string | null = null;
  private cache: Promise<DictionaryLoadResult> | null = null;
  private loaded: LoadedDictionary[] = [];

  reset(): void {
    for (const dictionary of this.loaded) {
      try {
        dictionary.mdx.close();
      } catch {
        // Already closed.
      }
      for (const mdd of dictionary.mdds.values()) {
        try {
          mdd?.close();
        } catch {
          // Already closed.
        }
      }
    }
    this.loaded = [];
    this.cache = null;
    this.cacheKey = null;
  }

  private async load(
    configs: DictionaryConfig[],
  ): Promise<DictionaryLoadResult> {
    const errors: string[] = [];
    const enabled = configs.filter((config) => config.enabled);
    if (enabled.length === 0) {
      return {
        dictionaries: [],
        errors: ["尚未配置或启用任何 MDX 词典"],
      };
    }

    const dictionaries: LoadedDictionary[] = [];
    for (const config of enabled) {
      if (!(await IOUtils.exists(config.mdxPath))) {
        errors.push(`${config.name} 文件不存在：${config.mdxPath}`);
        continue;
      }

      const existing = [config.mdxPath];
      for (const path of config.mddPaths) {
        if (await IOUtils.exists(path)) {
          existing.push(path);
        } else {
          errors.push(`${config.name} 资源文件不存在：${path}`);
        }
      }
      const expanded = await discoverSiblingMDDPaths(existing);
      const group = groupDictionaryPaths(expanded).find(
        (candidate) =>
          candidate.mdxPath.toLocaleLowerCase() ===
          config.mdxPath.toLocaleLowerCase(),
      );
      if (!group) {
        errors.push(`${config.name} 无法识别 MDX 配置`);
        continue;
      }

      try {
        await Zotero.Promise.delay(0);
        dictionaries.push({
          ...group,
          name: config.name || group.name,
          mdx: new MDX(group.mdxPath, {
            passcode: "",
            isStripKey: true,
            isCaseSensitive: false,
            resort: true,
          }),
          mdds: new Map(),
        });
      } catch (error) {
        errors.push(`${group.name} 加载失败：${String(error)}`);
        Zotero.logError(error as Error);
      }
    }
    this.loaded = dictionaries;
    return { dictionaries, errors };
  }

  private getDictionaries(): Promise<DictionaryLoadResult> {
    const configs = loadDictionaryConfigs();
    const cacheKey = JSON.stringify(configs);
    if (this.cacheKey !== cacheKey || !this.cache) {
      this.reset();
      this.cacheKey = cacheKey;
      this.cache = this.load(configs).catch((error) => {
        this.cache = null;
        throw error;
      });
    }
    return this.cache;
  }

  async lookup(word: string): Promise<LocalLookupResult> {
    const loaded = await this.getDictionaries();
    const entries: DictionaryEntry[] = [];
    const errors = [...loaded.errors];

    for (const dictionary of loaded.dictionaries) {
      let matched: { definition: string; headword: string } | null = null;
      try {
        matched = resolveDefinition(dictionary.mdx, word);
      } catch (error) {
        errors.push(`${dictionary.name} 查询失败：${String(error)}`);
        Zotero.logError(error as Error);
      }
      if (!matched) continue;

      try {
        const parsed = parseDefinition(matched.definition, matched.headword);
        const references =
          parsed.audioReferences.length > 0
            ? parsed.audioReferences
            : extractAudioReferences(matched.definition);
        const audio: AudioAsset[] = [];
        for (const reference of references) {
          const item = await lookupAudioReference(dictionary, reference);
          if (item) audio.push(item);
          if (audio.length >= MAX_AUDIO_ITEMS_PER_DICTIONARY) break;
        }
        entries.push({
          source: dictionary.name,
          headword: matched.headword,
          pronunciations: parsed.pronunciations,
          senses: parsed.senses,
          forms: parsed.forms,
          tags: parsed.tags,
          audio,
        });
      } catch (error) {
        errors.push(`${dictionary.name} 解析失败：${String(error)}`);
        Zotero.logError(error as Error);
      }
    }

    return {
      word: word.trim(),
      entries,
      errors,
      configuredDictionaries: loaded.dictionaries.length,
    };
  }
}
