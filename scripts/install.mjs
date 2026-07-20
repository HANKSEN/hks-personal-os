#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { auditExistingDirectory } from "./lib/audit.mjs";
import { PosError, invariant } from "./lib/errors.mjs";
import { copyPath, exists, readJson, writeJsonAtomic } from "./lib/io.mjs";
import { applyHostIntegrations, interactiveApprovalSummary, planHostIntegrations } from "./lib/host-integration.mjs";
import {
  buildPackageManifest,
  compareLegacyToSource,
  INSTALL_MARKER_V1,
  INSTALL_MARKER_V2,
  MANIFEST_FILE,
  MARKER_FILE,
  verifyInstalledPackage,
} from "./lib/package-integrity.mjs";
import { BACKUP_WARNING, initializeWorkspace, inspectWorkspacePath, nextForCandidate, onboardingResult, setupEnvelope } from "./lib/setup.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const WARNING = "Before authorizing any Agent to access valuable files, create a complete independent backup or snapshot and verify that it can be restored. Installation does not back up personal data.";
const HELP = `Personal OS Skill-first setup

Usage:
  personal-os setup [--agent auto|all|generic|codex|claude|none] [--skill-dir <parent>] [--yes]
  personal-os install [--agent ...] [--with-cli] [--yes]
  personal-os update [--agent ...] [--skill-dir <parent>] [--yes]
  personal-os rollback --to <installed-version> [--yes]
  personal-os [legacy install options]

Options:
  --agent <targets>     Comma-separated targets. Default: auto.
  --skill-dir <parent> Add a host-supported custom Skill parent directory. Repeatable.
  --data-dir <path>    Versioned package storage. Default: XDG_DATA_HOME/personal-os or ~/.local/share/personal-os.
  --bin-dir <path>     Optional global CLI link directory. Default: ~/.local/bin.
  --with-cli           Also install global pos and personal-os commands. Not required for normal Skill use.
  --no-interactive-approval  Do not register the visual approval MCP adapter. Compatible detected hosts enable it by default.
  --to <version>       Installed target version for rollback.
  --install-only       Stop after installing and verifying the Skill.
  --workspace-mode     new or existing.
  --root <path>        Candidate new Personal OS root.
  --source <path>      Existing directory to audit.
  --target <path>      New Personal OS target for the existing-directory journey.
  --areas <names>      Optional comma-separated Areas for a new root.
  --mode <mode>        safe, collaborative, or trusted. Default: collaborative.
  --initialize         Explicitly authorize initialization of the displayed missing or empty root.
  --dry-run            Show the complete plan without changing files.
  --yes                Apply the displayed installation plan.
  --json               Emit machine-readable JSON.
  --help               Show this help.

Default setup installs the Skill and its embedded runtime, not a global CLI. Software installation never authorizes access to a Personal OS data root; initialization requires --initialize or a separate interactive confirmation.`;

function parse(argv) {
  const options = { skillDirs: [] };
  const booleans = new Set(["yes", "dryRun", "json", "help", "withCli", "installOnly", "initialize", "interactiveApproval", "noInteractiveApproval"]);
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
    else if (["agent", "dataDir", "binDir", "workspaceMode", "root", "source", "target", "areas", "mode", "to"].includes(key)) options[key] = value;
    else throw new PosError("UNKNOWN_OPTION", "Unknown installer option.", { option: raw }, 2);
    index += 1;
  }
  return options;
}

function parseCommand(argv) {
  const [first, ...rest] = argv;
  if (["setup", "install", "update", "rollback"].includes(first)) return { command: first, options: parse(rest), legacy: false };
  return { command: "install", options: parse(argv), legacy: true };
}

function csv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parsedVersion(value) {
  const match = String(value ?? "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") ?? [] };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const leftNumber = /^\d+$/u.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/u.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber;
    if (leftNumber !== null && rightNumber === null) return -1;
    if (leftNumber === null && rightNumber !== null) return 1;
    const compared = left[index].localeCompare(right[index], "en");
    if (compared) return compared;
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parsedVersion(leftValue);
  const right = parsedVersion(rightValue);
  if (!left || !right) return String(leftValue).localeCompare(String(rightValue), "en", { numeric: true });
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  return comparePrerelease(left.prerelease, right.prerelease);
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

function runtimeEntries(packageJson) {
  return [...new Set([
    ...packageJson.files,
    "package.json",
    "README.md",
    "README.zh-CN.md",
    "AGENT_INSTALL.md",
    "AGENT_UPDATE.md",
    "CHANGELOG.md",
    "LICENSE",
    "install.sh",
  ])];
}

async function sourcePackageManifest(packageJson) {
  return buildPackageManifest(SOURCE_ROOT, {
    packageName: packageJson.name,
    version: packageJson.version,
    entries: runtimeEntries(packageJson),
  });
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

async function inspectVersion(versionDir, packageJson, sourceManifest) {
  const info = await statMaybe(versionDir);
  if (!info) return { action: "create", path: versionDir, integrity: "not-installed", sourceDigest: sourceManifest.digest };
  invariant(info.isDirectory() && !info.isSymbolicLink(), "INSTALL_DESTINATION_COLLISION", "Version destination exists but is not a managed Personal OS installation.", { path: versionDir }, 3);
  const markerPath = path.join(versionDir, MARKER_FILE);
  invariant(await exists(markerPath), "INSTALL_DESTINATION_COLLISION", "Version destination exists without a Personal OS installation marker.", { path: versionDir }, 3);
  const verified = await verifyInstalledPackage(versionDir, { packageName: packageJson.name, version: packageJson.version, allowLegacy: true });
  if (verified.status === "legacy-unverified") {
    const comparison = await compareLegacyToSource(versionDir, sourceManifest);
    invariant(comparison.matches, "IMMUTABLE_VERSION_MISMATCH", "An installed legacy package uses the same version but different content. Publish a new version instead of replacing it in place.", { version: packageJson.version, installedDigest: comparison.actual.digest, sourceDigest: sourceManifest.digest }, 4);
    return { action: "adopt-manifest", path: versionDir, integrity: "legacy-matches-source", sourceDigest: sourceManifest.digest };
  }
  invariant(verified.manifest.digest === sourceManifest.digest, "IMMUTABLE_VERSION_MISMATCH", "Source content differs from an already installed package with the same version. Version identifiers are immutable.", { version: packageJson.version, installedDigest: verified.manifest.digest, sourceDigest: sourceManifest.digest }, 4);
  return { action: "reuse", path: versionDir, integrity: "verified", sourceDigest: sourceManifest.digest };
}

async function inspectLink(destination, target, managedVersionsRoot) {
  const info = await statMaybe(destination);
  if (!info) return { action: "create", path: destination, target, current: null, currentVersion: null };
  invariant(info.isSymbolicLink(), "INSTALL_LINK_COLLISION", "Installer refuses to overwrite an existing non-link destination.", { path: destination }, 3);
  const raw = await readlink(destination);
  const current = path.resolve(path.dirname(destination), raw);
  invariant(inside(managedVersionsRoot, current), "INSTALL_LINK_COLLISION", "Installer refuses to replace an unrelated symbolic link.", { path: destination, current }, 3);
  const relative = path.relative(managedVersionsRoot, current);
  const [versionComponent] = relative.split(path.sep).filter(Boolean);
  invariant(versionComponent, "INSTALL_LINK_COLLISION", "Existing link does not identify a managed Personal OS version.", { path: destination, current }, 3);
  const markerPath = path.join(managedVersionsRoot, versionComponent, ".personal-os-install.json");
  invariant(await exists(markerPath), "INSTALL_LINK_COLLISION", "Existing link does not point to a managed Personal OS version.", { path: destination, current }, 3);
  const marker = await readJson(markerPath);
  invariant([INSTALL_MARKER_V1, INSTALL_MARKER_V2].includes(marker?.schema) && marker.package === "personal-os" && marker.version === versionComponent, "INSTALL_LINK_COLLISION", "Existing link does not point to a valid managed Personal OS version.", { path: destination, current, marker }, 3);
  if (current === path.resolve(target)) return { action: "reuse", path: destination, target, current, currentVersion: versionComponent };
  return { action: "update", path: destination, target, previous: current, current, currentVersion: versionComponent };
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

async function linkSnapshot(item) {
  const info = await statMaybe(item.path);
  if (!info) return { path: item.path, existed: false, raw: null, type: item.linkType };
  invariant(info.isSymbolicLink(), "INSTALL_LINK_COLLISION", "Managed link changed into a non-link after preview.", { path: item.path }, 4);
  return { path: item.path, existed: true, raw: await readlink(item.path), type: item.linkType };
}

async function restoreLinkSnapshot(snapshot) {
  const current = await statMaybe(snapshot.path);
  if (current) {
    invariant(current.isSymbolicLink(), "INSTALL_ROLLBACK_BLOCKED", "Cannot restore a managed link because its path became a non-link.", { path: snapshot.path }, 5);
    await unlink(snapshot.path);
  }
  if (snapshot.existed) {
    await mkdir(path.dirname(snapshot.path), { recursive: true });
    await symlink(snapshot.raw, snapshot.path, snapshot.type);
  }
}

async function applyLinksAtomically(items, afterLinks) {
  const changed = items.filter((item) => item.action !== "reuse");
  const snapshots = await Promise.all(changed.map(linkSnapshot));
  let applied = 0;
  try {
    for (const item of changed) {
      await applyLink(item, item.linkType);
      applied += 1;
      if (Number(process.env.POS_TEST_FAIL_UPDATE_AFTER_LINKS ?? 0) === applied) {
        throw new Error(`Synthetic link transaction failure after ${applied} links.`);
      }
    }
    if (afterLinks) await afterLinks();
  } catch (error) {
    const restoreErrors = [];
    for (const snapshot of snapshots.slice(0, applied).reverse()) {
      try {
        await restoreLinkSnapshot(snapshot);
      } catch (restoreError) {
        restoreErrors.push({ path: snapshot.path, message: restoreError instanceof Error ? restoreError.message : String(restoreError) });
      }
    }
    if (restoreErrors.length) {
      throw new PosError("INSTALL_LINK_ROLLBACK_FAILED", "Software link transaction failed and one or more previous links could not be restored.", { cause: error instanceof Error ? error.message : String(error), restoreErrors }, 5);
    }
    throw error;
  }
}

async function copyRuntimePackage(versionDir, packageJson, expectedManifest) {
  const versionsRoot = path.dirname(versionDir);
  await mkdir(versionsRoot, { recursive: true });
  const temporary = path.join(versionsRoot, `.install-${packageJson.version}-${process.pid}-${randomBytes(5).toString("hex")}`);
  await mkdir(temporary);
  const entries = runtimeEntries(packageJson);
  try {
    for (const relative of entries) {
      const source = path.join(SOURCE_ROOT, relative);
      invariant(await exists(source), "INVALID_PACKAGE", "A declared runtime package file is missing.", { path: relative }, 3);
      await copyPath(source, path.join(temporary, relative));
    }
    await chmod(path.join(temporary, "scripts", "pos.mjs"), 0o755);
    await chmod(path.join(temporary, "scripts", "install.mjs"), 0o755);
    await chmod(path.join(temporary, "install.sh"), 0o755);
    const copiedManifest = await buildPackageManifest(temporary, { packageName: packageJson.name, version: packageJson.version });
    invariant(copiedManifest.digest === expectedManifest.digest, "PACKAGE_COPY_INTEGRITY_MISMATCH", "Copied runtime package does not match the source package manifest.", { expected: expectedManifest.digest, actual: copiedManifest.digest }, 5);
    await writeJsonAtomic(path.join(temporary, MANIFEST_FILE), expectedManifest);
    await writeJsonAtomic(path.join(temporary, MARKER_FILE), {
      schema: INSTALL_MARKER_V2,
      package: packageJson.name,
      version: packageJson.version,
      packageDigest: expectedManifest.digest,
      installedAt: new Date().toISOString(),
    });
    await rename(temporary, versionDir);
    await verifyInstalledPackage(versionDir, { packageName: packageJson.name, version: packageJson.version, allowLegacy: false });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function adoptLegacyManifest(versionDir, packageJson, expectedManifest) {
  const comparison = await compareLegacyToSource(versionDir, expectedManifest);
  invariant(comparison.matches, "IMMUTABLE_VERSION_MISMATCH", "Legacy version content changed before manifest adoption.", { version: packageJson.version, expected: expectedManifest.digest, actual: comparison.actual.digest }, 4);
  await writeJsonAtomic(path.join(versionDir, MANIFEST_FILE), expectedManifest);
  await writeJsonAtomic(path.join(versionDir, MARKER_FILE), {
    schema: INSTALL_MARKER_V2,
    package: packageJson.name,
    version: packageJson.version,
    packageDigest: expectedManifest.digest,
    installedAt: new Date().toISOString(),
    adoptedLegacyAt: new Date().toISOString(),
  });
  return verifyInstalledPackage(versionDir, { packageName: packageJson.name, version: packageJson.version, allowLegacy: false });
}

export async function createInstallPlan(rawOptions = {}) {
  invariant(Number(process.versions.node.split(".")[0]) >= 20, "NODE_VERSION_UNSUPPORTED", "Personal OS requires Node.js 20 or later. Install a current Node.js LTS release and retry.", { current: process.versions.node }, 2);
  const packageJson = await packageInfo();
  const sourceManifest = await sourcePackageManifest(packageJson);
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
  const version = await inspectVersion(versionDir, packageJson, sourceManifest);
  const withCli = rawOptions.withCli === true || rawOptions.legacy === true;
  const binaries = withCli ? (await Promise.all([
    inspectLink(path.join(binDir, "pos"), path.join(versionDir, "scripts", "pos.mjs"), versionsRoot),
    inspectLink(path.join(binDir, "personal-os"), path.join(versionDir, "scripts", "install.mjs"), versionsRoot),
  ])).map((item) => ({ ...item, linkType: "file" })) : [];
  const skills = await Promise.all(skillParents.map(async ({ name, parent }) => ({
    name,
    parent,
    discovery: name === "custom" ? "explicit-host-path" : "known-skill-target",
    linkType: process.platform === "win32" ? "junction" : "dir",
    ...(await inspectLink(path.join(parent, "personal-os"), versionDir, versionsRoot)),
  })));
  const hostMode = skills.length === 0
    ? "runtime-only-compatibility"
    : skills.some((skill) => skill.name === "custom") ? "configured-skill-path" : "skill-discovery-targets";
  const pathConfigured = (process.env.PATH ?? "").split(path.delimiter).map((entry) => path.resolve(entry || ".")).includes(path.resolve(binDir));
  const integrations = await planHostIntegrations({
    home,
    cwd: rawOptions.cwd ?? home,
    env: rawOptions.env ?? process.env,
    skills,
    enabled: rawOptions.noInteractiveApproval !== true && rawOptions.interactiveApproval !== false,
    hostCommands: rawOptions.hostCommands ?? (rawOptions.home && path.resolve(rawOptions.home) !== path.resolve(process.env.HOME ?? os.homedir()) ? {} : null),
  });
  return {
    schema: "personal-os.install-plan.v1",
    package: packageJson.name,
    version: packageJson.version,
    source: SOURCE_ROOT,
    sourceDigest: sourceManifest.digest,
    dataRoot,
    statePath: path.join(dataRoot, "install-state.json"),
    versionInstall: version,
    installMode: withCli ? "skill-and-cli" : "skill-only",
    embeddedRuntime: path.join(versionDir, "scripts", "pos.mjs"),
    hostMode,
    compatibilityFallback: skills.length === 0,
    compatibilityNotice: rawOptions.legacy === true ? "Legacy install syntax remains supported for this compatibility period. Prefer `personal-os setup`; global CLI links are now opt-in there with --with-cli." : null,
    binaries,
    skills,
    binDir,
    pathConfigured,
    integrations,
    interactiveApproval: interactiveApprovalSummary(integrations),
    safetyGuide: path.join(versionDir, "docs", "safety.md"),
    warning: WARNING,
    dataBoundary: "Installer does not initialize, read, migrate, or modify a Personal OS data root.",
  };
}

async function readInstallState(dataRoot) {
  const statePath = path.join(dataRoot, "install-state.json");
  if (!(await exists(statePath))) return null;
  const state = await readJson(statePath);
  invariant(state?.schema === "personal-os.install-state.v1" && state.package === "personal-os", "INVALID_INSTALL_STATE", "Personal OS install state is invalid.", { path: statePath }, 3);
  invariant(parsedVersion(state.activeVersion) && typeof state.installDir === "string" && path.isAbsolute(state.installDir), "INVALID_INSTALL_STATE", "Personal OS install state has an invalid active version or package path.", { path: statePath }, 3);
  invariant(inside(path.join(dataRoot, "versions"), state.installDir), "INVALID_INSTALL_STATE", "Personal OS install state package path escapes the managed versions directory.", { path: statePath, installDir: state.installDir }, 3);
  invariant(Array.isArray(state.skills) && Array.isArray(state.binaries), "INVALID_INSTALL_STATE", "Personal OS install state targets must be arrays.", { path: statePath }, 3);
  for (const skill of state.skills) {
    invariant(typeof skill?.path === "string" && path.isAbsolute(skill.path) && typeof skill?.name === "string", "INVALID_INSTALL_STATE", "Personal OS install state contains an invalid Skill target.", { path: statePath, skill }, 3);
  }
  for (const binary of state.binaries) {
    invariant(typeof binary?.path === "string" && path.isAbsolute(binary.path) && ["pos", "personal-os"].includes(path.basename(binary.path)), "INVALID_INSTALL_STATE", "Personal OS install state contains an invalid CLI target.", { path: statePath, binary }, 3);
  }
  return state;
}

function uniqueVersions(items) {
  return [...new Set(items.map((item) => item.currentVersion).filter(Boolean))].sort(compareVersions);
}

function nextInstallState(plan, previousState, operation) {
  const previousVersions = uniqueVersions([...plan.skills, ...plan.binaries]);
  const history = Array.isArray(previousState?.history) ? previousState.history.slice(-19) : [];
  if (previousState?.activeVersion && previousState.activeVersion !== plan.version) {
    history.push({ version: previousState.activeVersion, replacedAt: new Date().toISOString(), operation });
  }
  const skills = new Map((previousState?.skills ?? []).map((item) => [path.resolve(item.path), item]));
  for (const { name, path: destination } of plan.skills) skills.set(path.resolve(destination), { name, path: destination });
  const binaries = new Map((previousState?.binaries ?? []).map((item) => [path.resolve(item.path), item]));
  for (const { path: destination } of plan.binaries) binaries.set(path.resolve(destination), { path: destination });
  return {
    schema: "personal-os.install-state.v1",
    package: "personal-os",
    activeVersion: plan.version,
    previousVersion: previousVersions.length === 1 ? previousVersions[0] : previousState?.activeVersion ?? null,
    previousVersions,
    installDir: plan.versionInstall.path,
    manifestDigest: plan.sourceDigest,
    skills: [...skills.values()],
    binaries: [...binaries.values()],
    integrations: plan.integrations ?? previousState?.integrations ?? [],
    updatedAt: new Date().toISOString(),
    operation,
    history,
  };
}

async function ensurePlanVersion(plan) {
  const packageJson = await packageInfo();
  const manifest = await sourcePackageManifest(packageJson);
  invariant(manifest.digest === plan.sourceDigest, "SOURCE_PACKAGE_CHANGED", "Source package changed after preview.", { expected: plan.sourceDigest, actual: manifest.digest }, 4);
  if (plan.versionInstall.action === "create") await copyRuntimePackage(plan.versionInstall.path, packageJson, manifest);
  else if (plan.versionInstall.action === "adopt-manifest") await adoptLegacyManifest(plan.versionInstall.path, packageJson, manifest);
  else await verifyInstalledPackage(plan.versionInstall.path, { packageName: packageJson.name, version: packageJson.version, allowLegacy: false });
  return { packageJson, manifest };
}

async function commitInstallationPlan(plan, operation) {
  await ensurePlanVersion(plan);
  const previousState = await readInstallState(plan.dataRoot);
  const state = nextInstallState(plan, previousState, operation);
  await applyLinksAtomically([...plan.binaries, ...plan.skills], async () => writeJsonAtomic(plan.statePath, state));
  return state;
}

export async function installPackage(options = {}) {
  const plan = await createInstallPlan(options);
  if (options.dryRun || !options.yes) return { applied: false, requiresApproval: !options.dryRun, plan };
  let state = await commitInstallationPlan(plan, options.operation ?? "install");
  const integrationResults = await applyHostIntegrations(plan.integrations, {
    home: path.resolve(options.home ?? process.env.HOME ?? os.homedir()),
    cwd: options.cwd ?? path.resolve(options.home ?? process.env.HOME ?? os.homedir()),
    env: options.env ?? process.env,
  });
  state = { ...state, integrations: integrationResults, interactiveApproval: interactiveApprovalSummary(integrationResults) };
  await writeJsonAtomic(plan.statePath, state);
  return {
    applied: true,
    version: plan.version,
    installDir: plan.versionInstall.path,
    installMode: plan.installMode,
    embeddedRuntime: plan.embeddedRuntime,
    hostMode: plan.hostMode,
    compatibilityFallback: plan.compatibilityFallback,
    compatibilityNotice: plan.compatibilityNotice,
    integrity: "verified",
    statePath: plan.statePath,
    previousVersions: state.previousVersions,
    binaries: plan.binaries.map(({ path: destination }) => destination),
    skills: plan.skills.map(({ name, path: destination }) => ({ name, path: destination })),
    safetyGuide: plan.safetyGuide,
    warning: WARNING,
    pathConfigured: plan.pathConfigured,
    integrations: integrationResults,
    interactiveApproval: interactiveApprovalSummary(integrationResults),
    next: [
      plan.skills.length === 0
        ? "No Skill discovery target was configured. Use the installed SKILL.md and embedded runtime explicitly; this is runtime-only compatibility mode."
        : plan.binaries.length > 0
        ? (plan.pathConfigured ? "Optional CLI is ready: pos help" : `Optional CLI was installed in ${plan.binDir}; add it to PATH only if you want terminal use.`)
        : "Use the Personal OS Skill through natural language; no global CLI is required.",
      "Restart or open a new Agent session if the host discovers newly installed Skills only at startup.",
      "Choose whether to create a new Personal OS or audit an existing directory.",
      integrationResults.some((item) => item.enabled)
        ? "Interactive approval is enabled for the detected compatible Agent host; start a new session so it can load the MCP adapter."
        : "This host will use explicit text confirmation unless an MCP-compatible adapter is configured later.",
      "Before authorizing access to valuable existing files, create and restore-test an independent backup.",
    ],
  };
}

function updateEnvironment(rawOptions = {}) {
  const home = path.resolve(rawOptions.home ?? process.env.HOME ?? os.homedir());
  const dataRoot = expandHome(rawOptions.dataDir ?? process.env.PERSONAL_OS_DATA_DIR ?? path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "personal-os"), home);
  const binDir = expandHome(rawOptions.binDir ?? process.env.PERSONAL_OS_BIN_DIR ?? path.join(home, ".local", "bin"), home);
  invariant(dataRoot !== path.parse(dataRoot).root && binDir !== path.parse(binDir).root, "UNSAFE_INSTALL_DESTINATION", "Updater refuses filesystem-root destinations.", { dataRoot, binDir }, 3);
  return { home, dataRoot, binDir, versionsRoot: path.join(dataRoot, "versions"), statePath: path.join(dataRoot, "install-state.json") };
}

async function managedExistingLink(destination, versionsRoot) {
  const info = await statMaybe(destination);
  if (!info || !info.isSymbolicLink()) return null;
  const raw = await readlink(destination);
  const current = path.resolve(path.dirname(destination), raw);
  if (!inside(versionsRoot, current)) return null;
  const relative = path.relative(versionsRoot, current);
  const [version] = relative.split(path.sep).filter(Boolean);
  if (!version) return null;
  const versionDir = path.join(versionsRoot, version);
  const markerPath = path.join(versionDir, MARKER_FILE);
  if (!(await exists(markerPath))) return null;
  const marker = await readJson(markerPath);
  invariant([INSTALL_MARKER_V1, INSTALL_MARKER_V2].includes(marker?.schema) && marker.package === "personal-os" && marker.version === version, "INVALID_MANAGED_LINK", "A software link points inside the Personal OS versions directory but its marker is invalid.", { path: destination, current }, 4);
  return { path: destination, current, currentVersion: version, versionDir, raw };
}

function binaryTarget(versionDir, destination) {
  const name = path.basename(destination);
  invariant(["pos", "personal-os"].includes(name), "INVALID_BINARY_STATE", "Install state contains an unsupported binary link.", { path: destination }, 3);
  return path.join(versionDir, "scripts", name === "pos" ? "pos.mjs" : "install.mjs");
}

async function plannedUpdateLinks(rawOptions, environment, versionDir, state) {
  const warnings = [];
  const skillCandidates = new Map();
  const addSkill = (name, destination, explicit = false) => {
    const resolved = path.resolve(destination);
    const current = skillCandidates.get(resolved);
    skillCandidates.set(resolved, { name: current?.name ?? name, path: resolved, explicit: current?.explicit || explicit });
  };
  for (const skill of state?.skills ?? []) addSkill(skill.name ?? "state", skill.path, false);

  const detected = {
    codex: await exists(path.join(environment.home, ".codex")),
    claude: await exists(path.join(environment.home, ".claude")),
  };
  const explicitlySelected = rawOptions.agent !== undefined || (rawOptions.skillDirs?.length ?? 0) > 0;
  const selected = selectedAgentParents(rawOptions.agent ?? "auto", environment.home, rawOptions.skillDirs ?? [], detected);
  for (const { name, parent } of selected) addSkill(name, path.join(parent, "personal-os"), explicitlySelected);

  const skills = [];
  for (const candidate of skillCandidates.values()) {
    const existing = await managedExistingLink(candidate.path, environment.versionsRoot);
    if (!existing && !candidate.explicit) {
      warnings.push({ code: "MANAGED_SKILL_MISSING", path: candidate.path, message: "Recorded or known Skill target is not an active managed link and will not be recreated automatically." });
      continue;
    }
    const inspected = await inspectLink(candidate.path, versionDir, environment.versionsRoot);
    skills.push({
      name: candidate.name,
      parent: path.dirname(candidate.path),
      discovery: candidate.name === "custom" || candidate.name === "state" ? "explicit-host-path" : "known-skill-target",
      linkType: process.platform === "win32" ? "junction" : "dir",
      ...inspected,
    });
  }

  const binaryCandidates = new Map();
  const addBinary = (destination, explicit = false) => {
    const resolved = path.resolve(destination);
    binaryCandidates.set(resolved, { path: resolved, explicit: binaryCandidates.get(resolved)?.explicit || explicit });
  };
  for (const binary of state?.binaries ?? []) addBinary(binary.path, false);
  for (const name of ["pos", "personal-os"]) addBinary(path.join(environment.binDir, name), rawOptions.withCli === true);

  const binaries = [];
  for (const candidate of binaryCandidates.values()) {
    const existing = await managedExistingLink(candidate.path, environment.versionsRoot);
    if (!existing && !candidate.explicit) continue;
    const inspected = await inspectLink(candidate.path, binaryTarget(versionDir, candidate.path), environment.versionsRoot);
    binaries.push({ ...inspected, linkType: "file" });
  }
  return { skills, binaries, warnings };
}

async function verifyCurrentVersions(currentVersions, versionsRoot) {
  const integrity = [];
  for (const version of currentVersions) {
    const result = await verifyInstalledPackage(path.join(versionsRoot, version), { packageName: "personal-os", version, allowLegacy: true });
    integrity.push({ version, status: result.status });
  }
  return integrity;
}

export async function createUpdatePlan(rawOptions = {}) {
  invariant(Number(process.versions.node.split(".")[0]) >= 20, "NODE_VERSION_UNSUPPORTED", "Personal OS requires Node.js 20 or later.", { current: process.versions.node }, 2);
  const packageJson = await packageInfo();
  const sourceManifest = await sourcePackageManifest(packageJson);
  const environment = updateEnvironment(rawOptions);
  const state = await readInstallState(environment.dataRoot);
  const versionDir = path.join(environment.versionsRoot, packageJson.version);
  const links = await plannedUpdateLinks(rawOptions, environment, versionDir, state);
  const currentVersions = uniqueVersions([...links.skills, ...links.binaries]);
  invariant(currentVersions.length > 0, "NO_MANAGED_INSTALLATION", "No active managed Personal OS installation was found. Use install or provide the original custom --skill-dir.", { dataRoot: environment.dataRoot }, 3);
  const newestCurrent = currentVersions.at(-1);
  invariant(compareVersions(packageJson.version, newestCurrent) >= 0, "UPDATE_WOULD_DOWNGRADE", "Update cannot activate an older version. Use rollback --to <installed-version>.", { currentVersions, targetVersion: packageJson.version }, 3);
  const versionInstall = await inspectVersion(versionDir, packageJson, sourceManifest);
  const changesLinks = [...links.skills, ...links.binaries].some((item) => item.action !== "reuse");
  const direction = compareVersions(packageJson.version, newestCurrent) > 0
    ? "upgrade"
    : changesLinks || versionInstall.action === "adopt-manifest" ? "repair-metadata-or-targets" : "up-to-date";
  const currentIntegrity = await verifyCurrentVersions(currentVersions, environment.versionsRoot);
  const integrations = await planHostIntegrations({
    home: environment.home,
    cwd: rawOptions.cwd ?? environment.home,
    env: rawOptions.env ?? process.env,
    skills: links.skills,
    enabled: rawOptions.noInteractiveApproval !== true && rawOptions.interactiveApproval !== false,
    hostCommands: rawOptions.hostCommands ?? (rawOptions.home && path.resolve(rawOptions.home) !== path.resolve(process.env.HOME ?? os.homedir()) ? {} : null),
  });
  return {
    schema: "personal-os.update-plan.v1",
    package: "personal-os",
    source: SOURCE_ROOT,
    sourceDigest: sourceManifest.digest,
    currentVersions,
    currentIntegrity,
    targetVersion: packageJson.version,
    version: packageJson.version,
    direction,
    versionInstall,
    dataRoot: environment.dataRoot,
    statePath: environment.statePath,
    binDir: environment.binDir,
    skills: links.skills,
    binaries: links.binaries,
    integrations,
    interactiveApproval: interactiveApprovalSummary(integrations),
    warnings: links.warnings,
    dataRootsAccessed: [],
    dataMigration: "not-performed",
    dataBoundary: "Software update does not discover, read, diagnose, migrate, or modify Personal OS data roots.",
    requiresRestart: true,
  };
}

export async function updatePackage(options = {}) {
  const plan = await createUpdatePlan(options);
  if (options.dryRun || !options.yes) return { applied: false, requiresApproval: !options.dryRun, plan };
  let state = await commitInstallationPlan(plan, "update");
  const integrationResults = await applyHostIntegrations(plan.integrations, {
    home: path.resolve(options.home ?? process.env.HOME ?? os.homedir()),
    cwd: options.cwd ?? path.resolve(options.home ?? process.env.HOME ?? os.homedir()),
    env: options.env ?? process.env,
  });
  state = { ...state, integrations: integrationResults, interactiveApproval: interactiveApprovalSummary(integrationResults) };
  await writeJsonAtomic(plan.statePath, state);
  return {
    schema: "personal-os.update-result.v1",
    applied: true,
    updated: plan.direction !== "up-to-date",
    previousVersions: plan.currentVersions,
    version: plan.targetVersion,
    direction: plan.direction,
    integrity: "verified",
    skills: plan.skills.map(({ name, path: destination }) => ({ name, path: destination })),
    binaries: plan.binaries.map(({ path: destination }) => destination),
    integrations: integrationResults,
    interactiveApproval: interactiveApprovalSummary(integrationResults),
    statePath: plan.statePath,
    dataRootsAccessed: [],
    dataMigration: "not-performed",
    restartRequired: true,
    next: [
      "Start a new Agent session so the host reloads the updated Skill and interactive approval adapter.",
      integrationResults.some((item) => item.enabled) ? "Interactive approval is enabled for a compatible host." : "Use exact proposal-ID text confirmation when the host cannot render interactive approval.",
      "If a release notes a data-schema change, authorize a separate root-specific compatibility workflow; this update did not access any data root.",
    ],
    state,
  };
}

export async function createRollbackPlan(rawOptions = {}) {
  invariant(typeof rawOptions.to === "string" && parsedVersion(rawOptions.to), "ROLLBACK_VERSION_REQUIRED", "Rollback requires --to <installed-semver-version>.", { to: rawOptions.to }, 2);
  const targetVersion = rawOptions.to.replace(/^v/u, "");
  const environment = updateEnvironment(rawOptions);
  const targetDir = path.join(environment.versionsRoot, targetVersion);
  const info = await statMaybe(targetDir);
  invariant(info?.isDirectory() && !info.isSymbolicLink(), "ROLLBACK_VERSION_NOT_INSTALLED", "Rollback target version is not installed.", { version: targetVersion, path: targetDir }, 3);
  const targetIntegrity = await verifyInstalledPackage(targetDir, { packageName: "personal-os", version: targetVersion, allowLegacy: true });
  const state = await readInstallState(environment.dataRoot);
  const links = await plannedUpdateLinks(rawOptions, environment, targetDir, state);
  const currentVersions = uniqueVersions([...links.skills, ...links.binaries]);
  invariant(currentVersions.length > 0, "NO_MANAGED_INSTALLATION", "No active managed Personal OS links were found for rollback.", { dataRoot: environment.dataRoot }, 3);
  const targetManifestDigest = targetIntegrity.manifest?.digest ?? null;
  const directionComparison = compareVersions(targetVersion, currentVersions.at(-1));
  return {
    schema: "personal-os.rollback-plan.v1",
    package: "personal-os",
    currentVersions,
    currentIntegrity: await verifyCurrentVersions(currentVersions, environment.versionsRoot),
    targetVersion,
    targetIntegrity: targetIntegrity.status,
    direction: directionComparison < 0 ? "rollback" : directionComparison > 0 ? "roll-forward" : "up-to-date",
    version: targetVersion,
    sourceDigest: targetManifestDigest,
    versionInstall: { action: "activate-existing", path: targetDir, integrity: targetIntegrity.status, sourceDigest: targetManifestDigest },
    dataRoot: environment.dataRoot,
    statePath: environment.statePath,
    binDir: environment.binDir,
    skills: links.skills,
    binaries: links.binaries,
    warnings: [
      ...links.warnings,
      ...(targetIntegrity.status === "legacy-unverified" ? [{ code: "LEGACY_TARGET_UNVERIFIED", message: "The rollback target predates package manifests. Core runtime files exist, but full content integrity cannot be claimed." }] : []),
    ],
    dataRootsAccessed: [],
    dataMigration: "not-reverted",
    dataBoundary: "Software rollback changes managed software links only. It does not reverse or access Personal OS data changes.",
    requiresRestart: true,
  };
}

export async function rollbackPackage(options = {}) {
  const plan = await createRollbackPlan(options);
  if (options.dryRun || !options.yes) return { applied: false, requiresApproval: !options.dryRun, plan };
  const target = await verifyInstalledPackage(plan.versionInstall.path, { packageName: "personal-os", version: plan.targetVersion, allowLegacy: true });
  invariant(target.status === plan.targetIntegrity, "ROLLBACK_TARGET_CHANGED", "Rollback target integrity status changed after preview.", { expected: plan.targetIntegrity, actual: target.status }, 4);
  if (target.manifest) invariant(target.manifest.digest === plan.sourceDigest, "ROLLBACK_TARGET_CHANGED", "Rollback target manifest changed after preview.", { expected: plan.sourceDigest, actual: target.manifest.digest }, 4);
  const previousState = await readInstallState(plan.dataRoot);
  const state = nextInstallState(plan, previousState, "rollback");
  await applyLinksAtomically([...plan.binaries, ...plan.skills], async () => writeJsonAtomic(plan.statePath, state));
  return {
    schema: "personal-os.rollback-result.v1",
    applied: true,
    previousVersions: plan.currentVersions,
    version: plan.targetVersion,
    direction: plan.direction,
    integrity: plan.targetIntegrity,
    warnings: plan.warnings,
    skills: plan.skills.map(({ name, path: destination }) => ({ name, path: destination })),
    binaries: plan.binaries.map(({ path: destination }) => destination),
    statePath: plan.statePath,
    dataRootsAccessed: [],
    dataMigration: "not-reverted",
    restartRequired: true,
    next: ["Start a new Agent session so the host reloads the selected Skill version.", "Software rollback did not reverse any Personal OS data change."],
    state,
  };
}

function installationSummary(result) {
  const skillTargets = result.skills?.map((item) => item.path) ?? result.plan?.skills?.map((item) => item.path) ?? [];
  return {
    skillInstalled: Boolean(result.applied) && skillTargets.length > 0,
    runtimeInstalled: Boolean(result.applied),
    skillTargets,
    embeddedRuntime: result.embeddedRuntime ?? result.plan?.embeddedRuntime ?? null,
    globalCliInstalled: (result.binaries?.length ?? result.plan?.binaries?.length ?? 0) > 0,
    hostMode: result.hostMode ?? result.plan?.hostMode ?? null,
    compatibilityFallback: result.compatibilityFallback ?? result.plan?.compatibilityFallback ?? false,
    installDir: result.installDir ?? result.plan?.versionInstall?.path ?? null,
    version: result.version ?? result.plan?.version ?? null,
    interactiveApproval: result.interactiveApproval ?? result.plan?.interactiveApproval ?? null,
    integrations: result.integrations ?? result.plan?.integrations ?? [],
  };
}

function yesAnswer(value) {
  return /^(?:y|yes|是|好|同意|继续)$/iu.test(String(value).trim());
}

function printInstallPlan(plan) {
  process.stdout.write(`\nPersonal OS Skill-first installation plan\n`);
  process.stdout.write(`- Version package: ${plan.versionInstall.path} (${plan.versionInstall.action})\n`);
  for (const skill of plan.skills) process.stdout.write(`- Skill: ${skill.path} (${skill.action})\n`);
  for (const binary of plan.binaries) process.stdout.write(`- Optional CLI: ${binary.path} (${binary.action})\n`);
  for (const integration of plan.integrations ?? []) process.stdout.write(`- Interactive approval (${integration.host}): ${integration.action}\n`);
  process.stdout.write(`- Mode: ${plan.installMode}\n`);
  process.stdout.write(`- Safety: software installation does not authorize access to personal data directories.\n\n`);
}

function printSoftwareChangePlan(label, plan) {
  process.stdout.write(`\nPersonal OS ${label} plan\n`);
  process.stdout.write(`- Current version(s): ${plan.currentVersions.join(", ")}\n`);
  process.stdout.write(`- Target version: ${plan.targetVersion}\n`);
  process.stdout.write(`- Direction: ${plan.direction}\n`);
  process.stdout.write(`- Target integrity: ${plan.targetIntegrity ?? plan.versionInstall.integrity}\n`);
  for (const skill of plan.skills) process.stdout.write(`- Skill: ${skill.path} (${skill.action})\n`);
  for (const binary of plan.binaries) process.stdout.write(`- Optional CLI: ${binary.path} (${binary.action})\n`);
  for (const integration of plan.integrations ?? []) process.stdout.write(`- Interactive approval (${integration.host}): ${integration.action}\n`);
  for (const warning of plan.warnings ?? []) process.stdout.write(`- Warning: ${warning.message}\n`);
  process.stdout.write(`- Data boundary: ${plan.dataBoundary}\n\n`);
}

async function runInteractiveSoftwareChange(command, initialOptions = {}) {
  const operation = command === "update" ? updatePackage : rollbackPackage;
  const preview = await operation({ ...initialOptions, dryRun: true, yes: false });
  printSoftwareChangePlan(command, preview.plan);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${command === "update" ? "Apply this software update" : "Activate this installed version"}? [y/N] `);
    if (!yesAnswer(answer)) return { ...preview, aborted: true };
    return operation({ ...initialOptions, dryRun: false, yes: true });
  } finally {
    rl.close();
  }
}

async function runInteractiveSetup(initialOptions = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const options = { ...initialOptions };
  try {
    if (!options.yes) {
      const preview = await installPackage({ ...options, dryRun: true });
      printInstallPlan(preview.plan);
      const approved = await rl.question("Install the Skill and embedded runtime? [y/N] ");
      if (!yesAnswer(approved)) return setupEnvelope({ state: "ABORTED", installation: installationSummary(preview), nextAction: { type: "none" } });
      options.yes = true;
      options.dryRun = false;
    }

    let result = await runSetup(options);
    if (result.state === "WAIT_WORKSPACE_MODE") {
      const mode = await rl.question("Create a new Personal OS or organize an existing directory? [new/existing, default: new] ");
      options.workspaceMode = String(mode).trim().toLowerCase() === "existing" ? "existing" : "new";
      result = await runSetup(options);
    }

    if (result.state === "WAIT_ROOT_PATH") {
      const suggested = path.join(process.cwd(), "Personal_OS");
      const answer = await rl.question(`Where should the new Personal OS be created? [${suggested}] `);
      options.root = String(answer).trim() || suggested;
      result = await runSetup(options);
    }
    if (result.state === "WAIT_ROOT_CONFIRMATION") {
      process.stdout.write(`\nNew Personal OS root: ${result.workspace.candidateRoot}\nCurrent state: ${result.workspace.candidateState}\n`);
      const areas = await rl.question("Optional: enter 1-3 ongoing Areas separated by commas, or press Enter to skip: ");
      if (String(areas).trim()) options.areas = String(areas).trim();
      const approved = await rl.question("Initialize this exact missing or empty directory? [y/N] ");
      if (!yesAnswer(approved)) return { ...result, state: "ABORTED", pendingAuthorization: null, nextAction: { type: "none" } };
      options.initialize = true;
      result = await runSetup(options);
    }

    if (result.state === "WAIT_SOURCE_PATH") {
      const source = await rl.question("Enter the absolute path of the one existing directory to audit: ");
      options.source = String(source).trim();
      result = await runSetup(options);
    }
    if (result.state === "BACKUP_GATE") {
      process.stdout.write(`\n${BACKUP_WARNING}\nSource will be read-only: ${result.workspace.sourceRoot}\n`);
      const backupConfirmed = await rl.question("Have you created and restore-tested an independent backup, and do you authorize read-only audit? [y/N] ");
      if (!yesAnswer(backupConfirmed)) return { ...result, state: "ABORTED", pendingAuthorization: null, nextAction: { type: "none" } };
      const suggested = path.join(path.dirname(result.workspace.sourceRoot), `${path.basename(result.workspace.sourceRoot)}-Personal-OS`);
      const target = await rl.question(`Choose a new target Personal OS directory. [${suggested}] `);
      options.target = String(target).trim() || suggested;
      result = await runSetup(options);
    }
    if (result.state === "WAIT_TARGET_CONFIRMATION") {
      process.stdout.write(`\nSource remains read-only: ${result.workspace.sourceRoot}\nNew target: ${result.workspace.targetRoot}\n`);
      const approved = await rl.question("Initialize this new target directory? [y/N] ");
      if (!yesAnswer(approved)) return { ...result, state: "ABORTED", pendingAuthorization: null, nextAction: { type: "none" } };
      options.initialize = true;
      result = await runSetup(options);
    }
    if (result.state === "WAIT_AUDIT_APPROVAL") {
      const approved = await rl.question(`Run the read-only audit now? Reports will be written only to ${result.workspace.targetRoot}. [y/N] `);
      if (!yesAnswer(approved)) return result;
      const audit = await auditExistingDirectory(result.workspace.targetRoot, result.workspace.sourceRoot, { yesRead: true });
      return setupEnvelope({
        state: "REVIEW_AUDIT_REPORT",
        journey: "existing",
        installation: result.installation,
        workspace: { ...result.workspace, authorizedAccess: "source-read-target-write" },
        completed: [...result.completed, "READ_ONLY_AUDIT"],
        health: result.health,
        nextAction: { type: "review-migration-plan", plan: audit.plan },
        onboarding: { audit },
      });
    }
    return result;
  } finally {
    rl.close();
  }
}

export async function runSetup(options = {}) {
  const installed = await installPackage(options);
  const installation = installationSummary(installed);
  if (!installed.applied) {
    return setupEnvelope({
      state: "WAIT_INSTALL_APPROVAL",
      installation,
      completed: ["PREFLIGHT", "INSTALL_PLAN"],
      pendingAuthorization: {
        operation: "install-software",
        paths: [installed.plan.versionInstall.path, ...installed.plan.skills.map((item) => item.path), ...installed.plan.binaries.map((item) => item.path)],
        integrations: installed.plan.integrations.map((item) => ({ host: item.host, action: item.action, name: item.name, command: item.command ?? null })),
        access: "write",
      },
      nextAction: { type: "rerun", arguments: ["setup", "--yes"] },
      issues: [],
    });
  }
  if (options.installOnly) {
    return setupEnvelope({
      state: "COMPLETE",
      installation,
      completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL"],
      nextAction: { type: "start-new-agent-session-if-required" },
    });
  }

  const journey = options.workspaceMode ?? (options.source ? "existing" : options.root ? "new" : null);
  invariant(journey === null || ["new", "existing"].includes(journey), "INVALID_WORKSPACE_MODE", "Workspace mode must be new or existing.", { workspaceMode: journey }, 2);
  if (!journey) {
    return setupEnvelope({
      state: "WAIT_WORKSPACE_MODE",
      installation,
      completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL"],
      nextAction: { type: "ask-user", promptKey: "choose-new-or-existing" },
    });
  }

  if (journey === "existing") {
    if (!options.source) {
      return setupEnvelope({
        state: "WAIT_SOURCE_PATH",
        journey,
        installation,
        completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "WAIT_WORKSPACE_MODE"],
        nextAction: { type: "ask-user", promptKey: "choose-existing-source-root" },
      });
    }
    const source = await inspectWorkspacePath(options.source);
    invariant(["non-empty", "initialized"].includes(source.state), "INVALID_AUDIT_SOURCE", "Existing-directory source must be an existing non-empty directory.", source, 3);
    if (!options.target) {
      return setupEnvelope({
        state: "BACKUP_GATE",
        journey,
        installation,
        workspace: { sourceRoot: source.path, sourceState: source.state, authorizedAccess: "none" },
        completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_SOURCE_ROOT"],
        pendingAuthorization: { operation: "audit-source-readonly", path: source.path, access: "read" },
        nextAction: { type: "ask-user", promptKey: "confirm-backup-and-choose-new-target" },
        issues: [],
      });
    }
    const target = await inspectWorkspacePath(options.target);
    if (!options.initialize && target.safeForInitialization) {
      return setupEnvelope({
        state: "WAIT_TARGET_CONFIRMATION",
        journey,
        installation,
        workspace: { sourceRoot: source.path, sourceState: source.state, targetRoot: target.path, targetState: target.state, authorizedAccess: "none" },
        completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_SOURCE_ROOT", "BACKUP_GATE", "RESOLVE_TARGET_ROOT"],
        pendingAuthorization: { operation: "initialize-new-target", path: target.path, access: "write" },
        nextAction: { type: "ask-user", promptKey: "confirm-existing-journey-target" },
      });
    }
    if (options.initialize && target.safeForInitialization) {
      const { initialized, health } = await initializeWorkspace(target.path, { areas: csv(options.areas), mode: options.mode ?? "collaborative" });
      return setupEnvelope({
        state: "WAIT_AUDIT_APPROVAL",
        journey,
        installation,
        workspace: { sourceRoot: source.path, sourceState: source.state, targetRoot: initialized.root, targetState: "initialized", authorizedAccess: "target-write" },
        completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_SOURCE_ROOT", "BACKUP_GATE", "RESOLVE_TARGET_ROOT", "INITIALIZE_TARGET", "HEALTH_CHECK"],
        pendingAuthorization: { operation: "audit-source-readonly", path: source.path, access: "read" },
        health,
        nextAction: { type: "run-embedded", command: "audit", target: initialized.root, source: source.path },
      });
    }
    return setupEnvelope({
      state: target.state === "initialized" ? "WAIT_AUDIT_APPROVAL" : "RECOVERABLE_FAILURE",
      journey,
      installation,
      workspace: { sourceRoot: source.path, sourceState: source.state, targetRoot: target.path, targetState: target.state, authorizedAccess: "none" },
      completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_SOURCE_ROOT", "BACKUP_GATE", "RESOLVE_TARGET_ROOT"],
      pendingAuthorization: target.state === "initialized" ? { operation: "audit-source-readonly", path: source.path, access: "read" } : null,
      nextAction: target.state === "initialized" ? { type: "run-embedded", command: "audit", target: target.path, source: source.path } : { type: "choose-another-target" },
      issues: target.state === "initialized" ? [] : [{ code: "TARGET_NOT_INITIALIZED", message: "Initialize an approved missing or empty target before auditing." }],
    });
  }

  if (!options.root) {
    return setupEnvelope({
      state: "WAIT_ROOT_PATH",
      journey,
      installation,
      completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "WAIT_WORKSPACE_MODE"],
      nextAction: { type: "ask-user", promptKey: "choose-new-root" },
    });
  }
  const candidate = await inspectWorkspacePath(options.root);
  if (!options.initialize) return nextForCandidate(candidate, installation, journey);
  invariant(candidate.safeForInitialization, "WORKSPACE_NOT_EMPTY", "The authorized initialization target is not missing or empty.", candidate, 3);
  const { initialized, health } = await initializeWorkspace(candidate.path, { areas: csv(options.areas), mode: options.mode ?? "collaborative" });
  return setupEnvelope({
    state: "FIRST_REAL_TASK",
    journey,
    installation,
    workspace: { root: initialized.root, candidateState: candidate.state, authorizedAccess: "write" },
    completed: ["PREFLIGHT", "INSTALL_PLAN", "INSTALL_SKILL", "VERIFY_SKILL", "WAIT_WORKSPACE_MODE", "RESOLVE_NEW_ROOT", "INITIALIZE_ROOT", "HEALTH_CHECK"],
    health,
    nextAction: { type: "ask-user", promptKey: "offer-first-real-task", skippable: true },
    onboarding: onboardingResult(initialized.root),
  });
}

async function main() {
  const { command, options, legacy } = parseCommand(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  options.legacy = legacy;
  const interactive = process.stdin.isTTY && !options.json && !options.dryRun && !options.yes;
  const result = command === "setup" && interactive
    ? await runInteractiveSetup(options)
    : command === "setup" ? await runSetup(options)
    : ["update", "rollback"].includes(command) && interactive ? await runInteractiveSoftwareChange(command, options)
    : command === "update" ? await updatePackage(options)
    : command === "rollback" ? await rollbackPackage(options)
    : await installPackage(options);
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
