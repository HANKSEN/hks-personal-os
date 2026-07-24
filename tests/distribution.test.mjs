import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("release bundle stays below the weak-network budget and carries offline install metadata", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "personal-os-release-"));
  try {
    const packageMetadata = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    assert.equal(packageMetadata.files.includes("assets"), false);
    assert.equal(packageMetadata.files.some((item) => item === "tests" || item.startsWith("specs") || item.startsWith("private")), false);
    const { stdout } = await execFileAsync(process.execPath, ["scripts/release-bundle.mjs", "--output", output], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        HOME: output,
        npm_config_cache: path.join(output, ".npm-cache"),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    const manifest = JSON.parse(stdout);
    assert.equal(manifest.schema, "personal-os.release-bundle.v1");
    assert.ok(manifest.size < 1024 * 1024);
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/u);
    assert.match(manifest.install, /--install-only --yes --json/u);
    const checksums = await readFile(path.join(output, "SHA256SUMS"), "utf8");
    assert.match(checksums, new RegExp(manifest.sha256, "u"));
    const archive = path.join(output, manifest.filename);
    const dataDir = path.join(output, "installed-data");
    const installed = await execFileAsync("npx", [
      "--yes",
      `--package=${archive}`,
      "personal-os",
      "setup",
      "--agent",
      "none",
      "--data-dir",
      dataDir,
      "--install-only",
      "--yes",
      "--json",
    ], {
      cwd: output,
      env: {
        ...process.env,
        HOME: path.join(output, "home"),
        npm_config_cache: path.join(output, ".npm-runtime-cache"),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(installed.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.result.state, "COMPLETE");
    assert.equal(result.result.installation.version, manifest.version);
    assert.equal(result.result.installation.globalCliInstalled, false);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
