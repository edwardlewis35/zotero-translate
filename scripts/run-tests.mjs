import { build } from "esbuild";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = await mkdtemp(path.join(tmpdir(), "lexiflow-tests-"));
try {
  const tests = (await readdir("tests"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
  for (const name of tests) {
    const output = path.join(temp, name.replace(/\.ts$/u, ".mjs"));
    await build({
      entryPoints: [path.join("tests", name)],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      loader: { ".css": "text" },
      logLevel: "silent",
    });
    const result = spawnSync(process.execPath, [output], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${name} failed (exit ${result.status})`);
  }
  console.log(
    `${tests.length} test suites passed. DOM tests use mocks, not a live Zotero instance.`,
  );
} finally {
  // Only the explicit mkdtemp directory created by this test run is removed.
  await rm(temp, { recursive: true, force: true });
}
