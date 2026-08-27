import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

const githubRepository =
  process.env.GITHUB_REPOSITORY ?? "edwardlewis35/zotero-translate";
const githubReleaseBase = `https://github.com/${githubRepository}/releases`;
const updateURL = `${githubReleaseBase}/latest/download/update.json`;

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: "lexiflow-zotero9-translator",
  xpiDownloadLink: `${githubReleaseBase}/download/v{{version}}/{{xpiName}}.xpi`,
  updateURL,
  build: {
    assets: ["addon/**/*.*"],
    makeManifest: {
      enable: false,
    },
    fluent: {
      dts: false,
    },
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
      updateURL,
    },
    esbuildOptions: [
      {
        entryPoints: [{ in: "src/index.ts", out: pkg.config.addonRef }],
        alias: {
          "node:fs": "./src/shims/node-fs.ts",
          assert: "./src/shims/assert.ts",
          zlib: "./src/shims/zlib.ts",
        },
        inject: ["./src/shims/buffer-inject.ts"],
        loader: {
          ".css": "text",
        },
        bundle: true,
        target: "firefox115",
        outdir: "build/addon/chrome/content/scripts",
      },
    ],
  },
});
