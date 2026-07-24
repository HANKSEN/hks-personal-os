#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractYamlFrontmatter,
  validateExecutableMetadata,
} from "./lib/platform-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "README.md",
  "README.zh-CN.md",
  "README.zh-TW.md",
  "README.en.md",
  "LICENSE",
  "LICENSE-DOCS.md",
  "LICENSES/CC-BY-SA-4.0.txt",
  "LICENSES/MIT-v1.0.0.txt",
  "LICENSING.md",
  "COMMERCIAL-LICENSE.md",
  "CONTRIBUTING.md",
  "SKILL.md",
  ".mcp.json",
  ".codebuddy-mcp.json",
  ".codebuddy-plugin/plugin.json",
  ".workbuddy-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "skills/personal-os/SKILL.md",
  "AGENT_SETUP.md",
  "AGENT_INSTALL.md",
  "AGENT_UPDATE.md",
  "install.sh",
  "agents/openai.yaml",
  "demo/approval-panel.html",
  "assets/templates/POS.md",
  "assets/templates/START_HERE.md",
  "assets/templates/AREA_CONTEXT.md",
  "assets/templates/PROJECT_CONTEXT.md",
  "assets/templates/AI_WORKSPACE_CONTEXT.md",
  "assets/templates/HOST_CONTEXT.md",
  "assets/templates/TASK.md",
  "assets/templates/RESULT.md",
  "assets/templates/CHANGESET.json",
  "assets/templates/policy.json",
  "assets/roles/orchestrator/ROLE.md",
  "assets/roles/research/ROLE.md",
  "assets/roles/creator/ROLE.md",
  "assets/roles/builder/ROLE.md",
  "assets/roles/reviewer/ROLE.md",
  "references/file-system.md",
  "references/router.md",
  "references/context-protocol.md",
  "references/security.md",
  "references/changesets.md",
  "references/workflows.md",
  "docs/install.md",
  "docs/install.en.md",
  "docs/update.md",
  "docs/update.en.md",
  "docs/ai-workspaces.md",
  "docs/ai-workspaces.en.md",
  "docs/first-run.md",
  "docs/first-run.en.md",
  "docs/existing-directory.md",
  "docs/existing-directory.en.md",
  "docs/setup-state-machine.md",
  "docs/user-journeys.md",
  "docs/compatibility.md",
  "docs/agent-compatibility.md",
  "docs/agent-compatibility.en.md",
  "docs/distribution.md",
  "docs/distribution.en.md",
  "docs/safety.md",
  "docs/safety.en.md",
  "docs/foundation/README.md",
  "docs/foundation/00-problem-and-audience.md",
  "docs/foundation/01-design-principles.md",
  "docs/foundation/02-conceptual-model.md",
  "docs/foundation/03-information-lifecycle.md",
  "docs/foundation/04-human-ai-boundary.md",
  "docs/foundation/05-safety-model.md",
  "docs/foundation/06-evaluation-method.md",
  "docs/foundation/07-sources-and-provenance.md",
  "rfcs/README.md",
  "rfcs/0001-inbox-as-router.md",
  "rfcs/0002-five-asset-model.md",
  "rfcs/0003-changeset-write-protocol.md",
  "rfcs/0004-interactive-approval.md",
  "scripts/install.mjs",
  "scripts/mcp-server.mjs",
  "scripts/demo-approval.mjs",
  "scripts/lib/approval.mjs",
  "scripts/lib/approval-visual.mjs",
  "scripts/lib/host-integration.mjs",
  "scripts/lib/host-registry.mjs",
  "scripts/lib/package-integrity.mjs",
  "scripts/lib/platform-validation.mjs",
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
const frontmatter = extractYamlFrontmatter(skill);
const keys = [...frontmatter.matchAll(/^([a-zA-Z0-9_-]+):/gmu)].map((match) => match[1]);
if (keys.join(",") !== "name,description") errors.push(`SKILL.md frontmatter must contain only name and description; found ${keys.join(", ")}.`);
if (!/^name: personal-os$/mu.test(frontmatter)) errors.push("SKILL.md name must be personal-os.");

for (const relative of [
  "package.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codebuddy-plugin/plugin.json",
  ".workbuddy-plugin/plugin.json",
  ".mcp.json",
  ".codebuddy-mcp.json",
  "assets/templates/CHANGESET.json",
  "assets/templates/policy.json",
]) {
  try {
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`Invalid JSON: ${relative}: ${error.message}`);
  }
}

try {
  const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (packageMetadata.license !== "AGPL-3.0-or-later") errors.push("package.json license must be AGPL-3.0-or-later.");
  if (packageMetadata.bin?.pos !== "./scripts/pos.mjs" || packageMetadata.bin?.["personal-os"] !== "./scripts/install.mjs") {
    errors.push("package.json must expose both pos and personal-os executables.");
  }
  for (const forbidden of ["specs", "internal", "private", "personal-data", "backups", "commercial", "cla-signatures", "legal/private"]) {
    if ((packageMetadata.files ?? []).some((entry) => entry === forbidden || entry.startsWith(`${forbidden}/`))) {
      errors.push(`Private source path must not be included in package.json files: ${forbidden}`);
    }
  }
  for (const relative of [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".codebuddy-plugin/plugin.json",
    ".workbuddy-plugin/plugin.json",
  ]) {
    const manifest = JSON.parse(await readFile(path.join(root, relative), "utf8"));
    if (manifest.version !== packageMetadata.version) errors.push(`${relative} version does not match package.json.`);
  }
  for (const relative of [
    "assets/roles/orchestrator/ROLE.md",
    "assets/roles/research/ROLE.md",
    "assets/roles/creator/ROLE.md",
    "assets/roles/builder/ROLE.md",
    "assets/roles/reviewer/ROLE.md",
  ]) {
    const manifest = await readFile(path.join(root, relative), "utf8");
    if (!new RegExp(`^version: ${packageMetadata.version.replaceAll(".", "\\.")}$`, "mu").test(manifest)) {
      errors.push(`${relative} version does not match package.json.`);
    }
  }
} catch (error) {
  errors.push(`Unable to validate package/adapter version consistency: ${error.message}`);
}

try {
  const agpl = await readFile(path.join(root, "LICENSE"), "utf8");
  if (!agpl.includes("GNU AFFERO GENERAL PUBLIC LICENSE") || !agpl.includes("Version 3, 19 November 2007")) {
    errors.push("LICENSE is not the bundled canonical AGPL-3.0 text.");
  }
  const cc = await readFile(path.join(root, "LICENSES/CC-BY-SA-4.0.txt"), "utf8");
  if (!cc.includes("Attribution-ShareAlike 4.0 International") || !cc.includes("Section 8 -- Interpretation")) {
    errors.push("CC BY-SA 4.0 legal text is missing or incomplete.");
  }
  const licensing = await readFile(path.join(root, "LICENSING.md"), "utf8");
  for (const requiredText of ["AGPL-3.0-or-later", "CC BY-SA 4.0", "v1.0.0", "用户内容与个人资产"]) {
    if (!licensing.includes(requiredText)) errors.push(`LICENSING.md is missing required boundary: ${requiredText}`);
  }
} catch (error) {
  errors.push(`Unable to validate license texts and scope: ${error.message}`);
}

for (const relative of ["install.sh", "scripts/install.mjs", "scripts/pos.mjs", "scripts/validate.mjs"]) {
  try {
    const info = await stat(path.join(root, relative));
    const content = await readFile(path.join(root, relative), "utf8");
    errors.push(...validateExecutableMetadata({
      relative,
      platform: process.platform,
      mode: info.mode,
      content,
    }));
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
      if (entry.name.endsWith(".md")) {
        for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
          let target = match[1].trim().replace(/^<|>$/gu, "");
          if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
          target = target.split("#")[0];
          if (!target) continue;
          const linked = path.resolve(path.dirname(absolute), decodeURIComponent(target));
          try {
            await stat(linked);
          } catch {
            errors.push(`Broken local Markdown link in ${relative}: ${match[1]}`);
          }
        }
      }
    }
  }
};
await scan(root);

if (errors.length) {
  for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
  process.exit(1);
}
process.stdout.write("Personal OS package structure is valid.\n");
