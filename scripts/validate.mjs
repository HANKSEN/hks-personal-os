#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "SKILL.md",
  "AGENT_INSTALL.md",
  "install.sh",
  "agents/openai.yaml",
  "assets/templates/POS.md",
  "assets/templates/AREA_CONTEXT.md",
  "assets/templates/PROJECT_CONTEXT.md",
  "assets/templates/AGENT.md",
  "assets/templates/TASK.md",
  "assets/templates/RESULT.md",
  "assets/templates/CHANGESET.json",
  "assets/templates/policy.json",
  "assets/agents/orchestrator/AGENT.md",
  "assets/agents/research/AGENT.md",
  "assets/agents/creator/AGENT.md",
  "assets/agents/builder/AGENT.md",
  "assets/agents/reviewer/AGENT.md",
  "references/file-system.md",
  "references/router.md",
  "references/context-protocol.md",
  "references/security.md",
  "references/changesets.md",
  "references/workflows.md",
  "docs/install.md",
  "docs/install.en.md",
  "docs/first-run.md",
  "docs/compatibility.md",
  "docs/safety.md",
  "docs/safety.en.md",
  "scripts/install.mjs",
  "scripts/pos.mjs",
  "package.json",
];
const errors = [];

for (const relative of required) {
  try {
    await stat(path.join(root, relative));
  } catch {
    errors.push(`Missing required file: ${relative}`);
  }
}

const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
if (skill.includes("TODO")) errors.push("SKILL.md contains TODO placeholders.");
if (skill.split(/\r?\n/u).length > 500) errors.push("SKILL.md exceeds 500 lines.");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
const keys = [...frontmatter.matchAll(/^([a-zA-Z0-9_-]+):/gmu)].map((match) => match[1]);
if (keys.join(",") !== "name,description") errors.push(`SKILL.md frontmatter must contain only name and description; found ${keys.join(", ")}.`);
if (!/^name: personal-os$/mu.test(frontmatter)) errors.push("SKILL.md name must be personal-os.");

for (const relative of ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "assets/templates/CHANGESET.json", "assets/templates/policy.json"]) {
  try {
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`Invalid JSON: ${relative}: ${error.message}`);
  }
}

try {
  const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (packageMetadata.bin?.pos !== "./scripts/pos.mjs" || packageMetadata.bin?.["personal-os"] !== "./scripts/install.mjs") {
    errors.push("package.json must expose both pos and personal-os executables.");
  }
  for (const relative of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(await readFile(path.join(root, relative), "utf8"));
    if (manifest.version !== packageMetadata.version) errors.push(`${relative} version does not match package.json.`);
  }
} catch (error) {
  errors.push(`Unable to validate package/adapter version consistency: ${error.message}`);
}

for (const relative of ["install.sh", "scripts/install.mjs", "scripts/pos.mjs", "scripts/validate.mjs"]) {
  try {
    const info = await stat(path.join(root, relative));
    if ((info.mode & 0o111) === 0) errors.push(`Executable file is missing execute permission: ${relative}`);
  } catch {
    // Required-file validation reports the missing path separately.
  }
}

for (const forbidden of ["output", "runs", ".runs"]) {
  try {
    await stat(path.join(root, forbidden));
    errors.push(`Runtime output directory must not exist in source package: ${forbidden}`);
  } catch {
    // Expected.
  }
}

const scan = async (directory, prefix = "") => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(absolute, relative);
    else if (entry.isFile() && /\.(?:md|mjs|json|yaml|yml)$/u.test(entry.name)) {
      const content = await readFile(absolute, "utf8");
      if (/\/Users\/[^/\s]+\/(?:Documents|Desktop|Downloads)\//u.test(content)) errors.push(`Private absolute path found in ${relative}.`);
    }
  }
};
await scan(root);

if (errors.length) {
  for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
  process.exit(1);
}
process.stdout.write("Personal OS package structure is valid.\n");
