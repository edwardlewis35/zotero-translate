import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { Script } from "node:vm";

// Run from the repository root, after `npm run build`.
// An optional build directory allows checking a copied release artifact.
const root = process.cwd();
const build = resolve(root, process.argv[2] ?? "build");
const xpiName = "lexiflow-zotero9-translator.xpi";
const xpiPath = join(build, xpiName);
const updatePath = join(build, "update.json");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const sourceManifest = JSON.parse(
  readFileSync(join(root, "addon/manifest.json"), "utf8"),
);
const id = pkg.config.addonID;
const version = pkg.version;
const repository =
  process.env.GITHUB_REPOSITORY ??
  pkg.repository.url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  )?.[1];
assert.match(
  repository ?? "",
  /^[\w.-]+\/[\w.-]+$/,
  "invalid GitHub repository",
);
const releaseBase = `https://github.com/${repository}/releases`;
const updateURL = `${releaseBase}/latest/download/update.json`;
const downloadURL = `${releaseBase}/download/v${version}/${xpiName}`;

function unzip(...args) {
  return execFileSync("unzip", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readEntry(name) {
  return unzip("-p", xpiPath, name);
}

function checkRange(zotero, context) {
  assert.equal(
    zotero?.strict_min_version,
    "9.0",
    `${context}: strict_min_version must be 9.0`,
  );
  assert.equal(
    zotero?.strict_max_version,
    "*",
    `${context}: strict_max_version must be * for Zotero 9+`,
  );
}

function sourceAssets(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceAssets(path);
    return [relative(join(root, "addon"), path).split(sep).join("/")];
  });
}

assert.equal(lock.version, version, "package-lock.json version is stale");
assert.equal(
  lock.packages?.[""].version,
  version,
  "package-lock.json root package version is stale",
);
checkRange(sourceManifest.applications?.zotero, "source manifest");
unzip("-t", xpiPath);
const entries = unzip("-Z1", xpiPath).trim().split(/\r?\n/);
const entrySet = new Set(entries);
assert.equal(entrySet.size, entries.length, "XPI contains duplicate entries");
for (const name of entries) {
  assert.ok(
    !name.startsWith("/") && !name.split("/").includes(".."),
    `unsafe XPI entry: ${name}`,
  );
}
const bundlePath = `chrome/content/scripts/${pkg.config.addonRef}.js`;
const required = new Set([
  "manifest.json",
  "bootstrap.js",
  "prefs.js",
  "chrome/content/preferences.xhtml",
  "chrome/content/preferences.css",
  "chrome/content/reader.css",
  "chrome/content/icons/icon.svg",
  bundlePath,
  ...sourceAssets(join(root, "addon")),
]);
for (const name of required) {
  assert.ok(entrySet.has(name), `XPI resource is missing: ${name}`);
  assert.ok(readEntry(name).length > 0, `XPI resource is empty: ${name}`);
}

const manifest = JSON.parse(readEntry("manifest.json"));
const zotero = manifest.applications?.zotero;
assert.equal(manifest.manifest_version, 2, "unexpected manifest format");
assert.equal(
  manifest.version,
  version,
  "XPI version does not match package.json",
);
assert.equal(manifest.name, pkg.config.addonName, "unexpected add-on name");
assert.equal(zotero?.id, id, "unexpected add-on ID");
assert.equal(zotero?.update_url, updateURL, "unexpected update manifest URL");
checkRange(zotero, "XPI manifest");

const placeholder =
  /__(?:addonName|buildVersion|description|author|addonID|updateURL|addonRef|prefsPrefix|addonInstance)__/;
for (const name of entries.filter((entry) =>
  /\.(?:js|json|xhtml|html|css|svg|ftl)$/.test(entry),
)) {
  const content = readEntry(name);
  assert.ok(
    !placeholder.test(content),
    `unexpanded placeholder in XPI: ${name}`,
  );
  if (name.endsWith(".js")) new Script(content, { filename: name });
}
assert.ok(
  readEntry("bootstrap.js").includes(bundlePath),
  "bootstrap.js does not load the packaged script",
);

const updateText = readFileSync(updatePath, "utf8");
assert.ok(
  !placeholder.test(updateText),
  "unexpanded placeholder in update.json",
);
const update = JSON.parse(updateText);
assert.deepEqual(
  Object.keys(update.addons ?? {}),
  [id],
  "unexpected update add-on ID",
);
const updates = update.addons[id].updates;
assert.ok(Array.isArray(updates), "update.json updates must be an array");
const matches = updates.filter((candidate) => candidate.version === version);
assert.equal(
  matches.length,
  1,
  "update.json must have exactly one current version",
);
const candidate = matches[0];
assert.equal(candidate.update_link, downloadURL, "unexpected XPI download URL");
checkRange(candidate.applications?.zotero, "update.json");
assert.equal(
  candidate.applications.zotero.strict_min_version,
  zotero.strict_min_version,
  "update.json and XPI minimum versions differ",
);
assert.equal(
  candidate.applications.zotero.strict_max_version,
  zotero.strict_max_version,
  "update.json and XPI maximum versions differ",
);
const hash = createHash("sha512").update(readFileSync(xpiPath)).digest("hex");
assert.equal(
  candidate.update_hash,
  `sha512:${hash}`,
  "update.json XPI hash is stale",
);

console.log(
  `Verified ${xpiName}: ${id} ${version}, Zotero 9.0+, SHA-512 and update URLs.`,
);
