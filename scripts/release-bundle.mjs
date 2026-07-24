#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const output = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : path.join(root, "dist"));
const maxBytes = 1024 * 1024;

await mkdir(output, { recursive: true });
const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", output], {
  cwd: root,
  env: {
    ...process.env,
    npm_config_cache: process.env.npm_config_cache ?? path.join(output, ".npm-cache"),
  },
  maxBuffer: 10 * 1024 * 1024,
});
const [packed] = JSON.parse(stdout);
const archive = path.join(output, packed.filename);
const bytes = await readFile(archive);
if (bytes.length > maxBytes) {
  throw new Error(`Release package is ${bytes.length} bytes; the weak-network budget is ${maxBytes} bytes.`);
}
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema: "personal-os.release-bundle.v1",
  package: packed.name,
  version: packed.version,
  filename: packed.filename,
  size: bytes.length,
  unpackedSize: packed.unpackedSize,
  entryCount: packed.entryCount,
  sha256,
  install: `npx --yes --package=./${packed.filename} personal-os setup --agent auto --install-only --yes --json`,
};
await writeFile(path.join(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, "SHA256SUMS"), `${sha256}  ${packed.filename}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
