#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PosError, invariant } from "./lib/errors.mjs";
import { copyPath, exists, readJson, writeJsonAtomic } from "./lib/io.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const WARNING = "Before authorizing any Agent to access valuable files, create a complete independent backup or snapshot and verify that it can be restored. Installation does not back up personal data.";
const HELP = `Personal OS user-local installer

Usage:
  personal-os [--agent auto|all|generic|codex|claude|none] [--skill-dir <parent>] [--yes]

Options:
  --agent <targets>     Comma-separated targets. Default: auto.
  --skill-dir <parent> Add a host-supported custom Skill parent directory. Repeatable.
  --data-dir <path>    Versioned package storage. Default: XDG_DATA_HOME/personal-os or ~/.local/share/personal-os.
  --bin-dir <path>     CLI link directory. Default: ~/.local/bin.
  --dry-run            Show the complete plan without changing files.
  --yes                Apply the displayed installation plan.
  --json               Emit machine-readable JSON.
  --help               Show this help.

The installer never initializes, reads, migrates, or modifies a Personal OS data root.`;

function parse(argv) {
  const options = { skillDirs: [] };
  const booleans = new Set(["yes", "dryRun", "json", "help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    invariant(raw.startsWith("--"), "UNKNOWN_ARGUMENT", "Installer accepts options only.", { argument: raw }, 2);
    const key = raw.slice(2).replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
    if (booleans.has(key)) {
      const next = argv[index + 1];
      if (next === "true" || next === "false") {
        options[key] = next === "true";
        index += 1;
      } else {
        options[key] = true;
      }
      continue;
    }
    const value = argv[index + 1];
    invariant(value !== undefined && !value.startsWith("--"), "OPTION_VALUE_REQUIRED", `Option ${raw} requires a value.`, { option: raw }, 2);
    if (key === "skillDir") options.skillDirs.push(value);
    else if (["agent", "dataDir", "binDir"].includes(key)) options[key] = value;
    else throw new PosError("UNKNOWN_OPTION", "Unknown installer option.", { option: raw }, 2);
    index += 1;
  }
  return options;
}

function expandHome(value, home) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return path.resolve(value);
}

async function statMaybe(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function packageInfo() {
  const packageJson = JSON.parse(await readFile(path.join(SOURCE_ROOT, "package.json"), "utf8"));
  invariant(packageJson.name === "personal-os" && typeof packageJson.version === "string", "INVALID_PACKAGE", "Invalid Personal OS package metadata.", undefined, 3);
  invariant(Array.isArray(packageJson.files), "INVALID_PACKAGE", "Personal OS package files list is missing.", undefined, 3);
  return packageJson;
}

function selectedAgentParents(agentOption, home, customParents, detected) {
  const requested = String(agentOption ?? "auto").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set(["auto", "all", "generic", "codex", "claude", "none"]);
  for (const item of requested) invariant(allowed.has(item), "UNKNOWN_AGENT_TARGET", "Unknown Agent target. Use auto, all, generic, codex, claude, none, or --skill-dir.", { target: item }, 2);

  const targets = new Map();
  const add = (name, parent) => targets.set(path.resolve(parent), { name, parent: path.resolve(parent) });
  const expanded = requested.includes("all") ? ["generic", "codex", "claude"] : requested;
  if (expanded.includes("auto")) {
    add("generic", path.join(home, ".agents", "skills"));
    if (detected.codex) add("codex", path.join(home, ".codex", "skills"));
    if (detected.claude) add("claude", path.join(home, ".claude", "skills"));
  }
  if (expanded.includes("generic")) add("generic", path.join(home, ".agents", "skills"));
  if (expanded.includes("codex")) add("codex", path.join(home, ".codex", "skills"));
  if (expanded.includes("claude")) add("claude", path.join(home, ".claude", "skills"));
  for (const parent of customParents) add("custom", expandHome(parent, home));
  return [...targets.values()];
}

async function inspectVersion(versionDir, packageJson) {
  const info = await statMaybe(versionDir);
  if (!info) return { action: "create", path: versionDir };
  invariant(info.isDirectory() && !info.isSymbolicLink(), "INSTALL_DESTINATION_COLLISION", "Version destination exists but is not a managed Personal OS installation.", { path: versionDir }, 3);
  const markerPath = path.join(versionDir, ".personal-os-install.json");
  invariant(await exists(markerPath), "INSTALL_DESTINATION_COLLISION", "Version destination exists without a Personal OS installation marker.", { path: versionDir }, 3);
  const marker = await readJson(markerPath);
  invariant(marker?.schema === "personal-os.install.v1" && marker.package === packageJson.name && marker.version === packageJson.version, "INSTALL_DESTINATION_COLLISION", "Version destination marker does not match this package.", { path: versionDir }, 3);
  return { action: "reuse", path: versionDir };
}

async function inspectLink(destination, target, managedVersionsRoot) {
  const info = await statMaybe(destination);
  if (!info) return { action: "create", path: destination, target };
  invariant(info.isSymbolicLink(), "INSTALL_LINK_COLLISION", "Installer refuses to overwrite an existing non-link destination.", { path: destination }, 3);
  const raw = await readlink(destination);
  const current = path.resolve(path.dirname(destination), raw);
  if (current === path.resolve(target)) return { action: "reuse", path: destination, target };
  invariant(inside(managedVersionsRoot, current), "INSTALL_LINK_COLLISION", "Installer refuses to replace an unrelated symbolic link.", { path: destination, current }, 3);
  const relative = path.relative(managedVersionsRoot, current);
  const [versionComponent] = relative.split(path.sep).filter(Boolean);
  invariant(versionComponent, "INSTALL_LINK_COLLISION", "Existing link does not identify a managed Personal OS version.", { path: destination, current }, 3);
  const markerPath = path.join(managedVersionsRoot, versionComponent, ".personal-os-install.json");
  invariant(await exists(markerPath), "INSTALL_LINK_COLLISION", "Existing link does not point to a managed Personal OS version.", { path: destination, current }, 3);
  return { action: "update", path: destination, target, previous: current };
}

async function applyLink(item, type) {
  if (item.action === "reuse") return;
  await mkdir(path.dirname(item.path), { recursive: true });
  if (item.action === "create") {
    try {
      await symlink(item.target, item.path, type);
    } catch (error) {
      if (error?.code === "EEXIST") throw new PosError("INSTALL_LINK_COLLISION", "Installation destination appeared before link creation.", { path: item.path }, 3);
      throw error;
    }
    return;
  }
  const currentRaw = await readlink(item.path);
  const current = path.resolve(path.dirname(item.path), currentRaw);
  invariant(current === item.previous, "INSTALL_LINK_CHANGED", "Existing Personal OS link changed after preview.", { path: item.path }, 4);
  await unlink(item.path);
  try {
    await symlink(item.target, item.path, type);
  } catch (error) {
    if (!(await exists(item.path))) await symlink(currentRaw, item.path, type);
    throw error;
  }
}

async function copyRuntimePackage(versionDir, packageJson) {
  const versionsRoot = path.dirname(versionDir);
  await mkdir(versionsRoot, { recursive: true });
  const temporary = path.join(versionsRoot, `.install-${packageJson.version}-${process.pid}-${randomBytes(5).toString("hex")}`);
  await mkdir(temporary);
  const entries = [...new Set([
    ...packageJson.files,
    "package.json",
    "README.md",
    "README.zh-CN.md",
    "AGENT_INSTALL.md",
    "CHANGELOG.md",
    "LICENSE",
    "install.sh",
  ])];
  try {
    for (const relative of entries) {
      const source = path.join(SOURCE_ROOT, relative);
      invariant(await exists(source), "INVALID_PACKAGE", "A declared runtime package file is missing.", { path: relative }, 3);
      await copyPath(source, path.join(temporary, relative));
    }
    await writeJsonAtomic(path.join(temporary, ".personal-os-install.json"), {
      schema: "personal-os.install.v1",
      package: packageJson.name,
      version: packageJson.version,
      installedAt: new Date().toISOString(),
    });
    await chmod(path.join(temporary, "scripts", "pos.mjs"), 0o755);
    await chmod(path.join(temporary, "scripts", "install.mjs"), 0o755);
    await chmod(path.join(temporary, "install.sh"), 0o755);
    await rename(temporary, versionDir);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function createInstallPlan(rawOptions = {}) {
  invariant(Number(process.versions.node.split(".")[0]) >= 20, "NODE_VERSION_UNSUPPORTED", "Personal OS requires Node.js 20 or later. Install a current Node.js LTS release and retry.", { current: process.versions.node }, 2);
  const packageJson = await packageInfo();
  const home = path.resolve(rawOptions.home ?? process.env.HOME ?? os.homedir());
  const dataRoot = expandHome(rawOptions.dataDir ?? process.env.PERSONAL_OS_DATA_DIR ?? path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "personal-os"), home);
  const binDir = expandHome(rawOptions.binDir ?? process.env.PERSONAL_OS_BIN_DIR ?? path.join(home, ".local", "bin"), home);
  invariant(dataRoot !== path.parse(dataRoot).root && binDir !== path.parse(binDir).root, "UNSAFE_INSTALL_DESTINATION", "Installer refuses filesystem-root destinations.", { dataRoot, binDir }, 3);
  const versionsRoot = path.join(dataRoot, "versions");
  const versionDir = path.join(versionsRoot, packageJson.version);
  const detected = {
    codex: await exists(path.join(home, ".codex")),
    claude: await exists(path.join(home, ".claude")),
  };
  const skillParents = selectedAgentParents(rawOptions.agent, home, rawOptions.skillDirs ?? [], detected);
  const version = await inspectVersion(versionDir, packageJson);
  const binaries = await Promise.all([
    inspectLink(path.join(binDir, "pos"), path.join(versionDir, "scripts", "pos.mjs"), versionsRoot),
    inspectLink(path.join(binDir, "personal-os"), path.join(versionDir, "scripts", "install.mjs"), versionsRoot),
  ]);
  const skills = await Promise.all(skillParents.map(async ({ name, parent }) => ({
    name,
    parent,
    ...(await inspectLink(path.join(parent, "personal-os"), versionDir, versionsRoot)),
  })));
  const pathConfigured = (process.env.PATH ?? "").split(path.delimiter).map((entry) => path.resolve(entry || ".")).includes(path.resolve(binDir));
  return {
    schema: "personal-os.install-plan.v1",
    package: packageJson.name,
    version: packageJson.version,
    source: SOURCE_ROOT,
    versionInstall: version,
    binaries,
    skills,
    binDir,
    pathConfigured,
    safetyGuide: path.join(versionDir, "docs", "safety.md"),
    warning: WARNING,
    dataBoundary: "Installer does not initialize, read, migrate, or modify a Personal OS data root.",
  };
}

export async function installPackage(options = {}) {
  const plan = await createInstallPlan(options);
  if (options.dryRun || !options.yes) return { applied: false, requiresApproval: !options.dryRun, plan };
  if (plan.versionInstall.action === "create") await copyRuntimePackage(plan.versionInstall.path, await packageInfo());
  for (const binary of plan.binaries) await applyLink(binary, "file");
  for (const skill of plan.skills) await applyLink(skill, process.platform === "win32" ? "junction" : "dir");
  return {
    applied: true,
    version: plan.version,
    installDir: plan.versionInstall.path,
    binaries: plan.binaries.map(({ path: destination }) => destination),
    skills: plan.skills.map(({ name, path: destination }) => ({ name, path: destination })),
    safetyGuide: plan.safetyGuide,
    warning: WARNING,
    pathConfigured: plan.pathConfigured,
    next: [
      plan.pathConfigured ? "Run: pos help" : `Add ${plan.binDir} to PATH, then run: pos help`,
      "Restart or open a new Agent session so it can discover the Skill.",
      "Before authorizing a data root, create and restore-test an independent backup.",
    ],
  };
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await installPackage(options);
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, options.json ? 0 : 2)}\n`);
}

async function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return await realpath(process.argv[1]) === await realpath(SCRIPT_PATH);
  } catch {
    return path.resolve(process.argv[1]) === SCRIPT_PATH;
  }
}

if (await isDirectExecution()) {
  main().catch((error) => {
    const payload = error instanceof PosError
      ? { ok: false, error: { code: error.code, message: error.message, details: error.details } }
      : { ok: false, error: { code: "INSTALL_FAILED", message: error instanceof Error ? error.message : String(error) } };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = error instanceof PosError ? error.exitCode : 5;
  });
}
