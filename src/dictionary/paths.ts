export interface DictionaryFileGroup {
  mdxPath: string;
  mddPaths: string[];
  name: string;
}

export function parseDictionaryPaths(raw: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const path = line.trim().replace(/^(['"])(.*)\1$/u, "$2");
    if (!path || !/\.(?:mdx|mdd)$/iu.test(path)) continue;
    const key = path.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

export function pathParts(path: string): {
  directory: string;
  filename: string;
} {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return {
    directory: slash >= 0 ? path.slice(0, slash) : "",
    filename: slash >= 0 ? path.slice(slash + 1) : path,
  };
}

function dictionaryLocation(path: string): {
  directory: string;
  stem: string;
} {
  const parts = pathParts(path);
  return {
    directory: parts.directory.replace(/\\/gu, "/").toLocaleLowerCase(),
    stem: parts.filename.replace(/\.m(?:dx|dd)$/iu, "").toLocaleLowerCase(),
  };
}

export function groupDictionaryPaths(paths: string[]): DictionaryFileGroup[] {
  const groups = paths
    .filter((path) => /\.mdx$/iu.test(path))
    .map((mdxPath) => ({
      mdxPath,
      mddPaths: [] as string[],
      name: pathParts(mdxPath).filename.replace(/\.mdx$/iu, ""),
    }));
  const locations = groups.map((group) => ({
    group,
    ...dictionaryLocation(group.mdxPath),
  }));

  for (const mddPath of paths.filter((path) => /\.mdd$/iu.test(path))) {
    const mdd = dictionaryLocation(mddPath);
    const candidates = locations
      .filter(
        (mdx) =>
          mdx.directory === mdd.directory &&
          (mdd.stem === mdx.stem ||
            /^\.\d+$/u.test(mdd.stem.slice(mdx.stem.length))),
      )
      .sort((a, b) => b.stem.length - a.stem.length);
    candidates[0]?.group.mddPaths.push(mddPath);
  }

  for (const location of locations) {
    location.group.mddPaths.sort((a, b) => {
      const aSuffix = dictionaryLocation(a).stem.slice(location.stem.length);
      const bSuffix = dictionaryLocation(b).stem.slice(location.stem.length);
      const aPart = aSuffix ? Number(aSuffix.slice(1)) : -1;
      const bPart = bSuffix ? Number(bSuffix.slice(1)) : -1;
      return aPart - bPart;
    });
  }
  return groups;
}

export async function discoverSiblingMDDPaths(
  configuredPaths: string[],
): Promise<string[]> {
  const discovered = [...configuredPaths];
  const known = new Set(
    configuredPaths.map((path) => path.toLocaleLowerCase()),
  );
  const directories = new Set(
    configuredPaths
      .filter((path) => /\.mdx$/iu.test(path))
      .map((path) => pathParts(path).directory)
      .filter(Boolean),
  );

  for (const directory of directories) {
    try {
      for (const path of await IOUtils.getChildren(directory)) {
        const key = path.toLocaleLowerCase();
        if (/\.mdd$/iu.test(path) && !known.has(key)) {
          discovered.push(path);
          known.add(key);
        }
      }
    } catch {
      // A configured MDX can still be loaded when its directory is not listable.
    }
  }
  return discovered;
}
