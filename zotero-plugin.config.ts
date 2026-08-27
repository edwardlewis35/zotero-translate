import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
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
