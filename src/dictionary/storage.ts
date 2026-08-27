import {
  discoverSiblingMDDPaths,
  groupDictionaryPaths,
  parseDictionaryPaths,
  pathParts,
} from "./paths";

const MANAGED_ROOT_NAME = "lexiflow-dict-translator";
const MANAGED_DICTIONARY_NAME = "dictionaries";

function pathHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFolderName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
      .replace(/[. ]+$/gu, "")
      .trim()
      .slice(0, 64) || "dictionary"
  );
}

function normalizedPath(path: string): string {
  return PathUtils.normalize(path).replace(/\\/gu, "/").toLocaleLowerCase();
}

export function getManagedDictionaryDirectory(): string {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    MANAGED_ROOT_NAME,
    MANAGED_DICTIONARY_NAME,
  );
}

export function isManagedDictionaryPath(path: string): boolean {
  const root = normalizedPath(getManagedDictionaryDirectory());
  const candidate = normalizedPath(path);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function managedGroupDirectory(sourceDirectory: string): string {
  const label =
    pathParts(sourceDirectory.replace(/[\\/]+$/gu, "")).filename ||
    "dictionary";
  return PathUtils.join(
    getManagedDictionaryDirectory(),
    `${safeFolderName(label)}-${pathHash(normalizedPath(sourceDirectory))}`,
  );
}

async function existingDictionaryPaths(paths: string[]): Promise<string[]> {
  const output: string[] = [];
  for (const path of paths) {
    if (await IOUtils.exists(path)) output.push(path);
  }
  return output;
}

/**
 * Copy selected dictionaries into Zotero's data directory. When an MDX is
 * selected, sibling MDD parts are imported with it so audio and other assets
 * keep working after the original files are moved.
 */
export async function importDictionaryFiles(
  selectedPaths: string[],
): Promise<string[]> {
  const selected = await existingDictionaryPaths(
    parseDictionaryPaths(selectedPaths.join("\n")),
  );
  if (selected.length === 0) return [];

  const expanded = await discoverSiblingMDDPaths(selected);
  const selectedKeys = new Set(selected.map(normalizedPath));
  const related = new Set(selected);
  for (const group of groupDictionaryPaths(expanded)) {
    if (!selectedKeys.has(normalizedPath(group.mdxPath))) continue;
    related.add(group.mdxPath);
    group.mddPaths.forEach((path) => related.add(path));
  }

  await IOUtils.makeDirectory(getManagedDictionaryDirectory(), {
    createAncestors: true,
    ignoreExisting: true,
  });

  const imported: string[] = [];
  for (const source of await existingDictionaryPaths([...related])) {
    if (isManagedDictionaryPath(source)) {
      imported.push(source);
      continue;
    }
    const parts = pathParts(source);
    const destinationDirectory = managedGroupDirectory(parts.directory);
    await IOUtils.makeDirectory(destinationDirectory, {
      createAncestors: true,
      ignoreExisting: true,
    });
    const destination = PathUtils.join(destinationDirectory, parts.filename);
    await IOUtils.copy(source, destination, { noOverwrite: false });
    imported.push(destination);
  }

  return parseDictionaryPaths(imported.join("\n"));
}
