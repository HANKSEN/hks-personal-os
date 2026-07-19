import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AI_WORKSPACE_LAYOUT, LEGACY_AI_WORKSPACE_LAYOUT, workspaceLayout } from "./ai-workspace.mjs";
import { PosError, invariant } from "./errors.mjs";
import { atomicWrite, ensureDir, exists, isoNow, readJson, writeJsonAtomic } from "./io.mjs";
import { openRoot } from "./root.mjs";
import { assertNoSymlinkComponents, resolveInside } from "./safe-path.mjs";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(CURRENT_DIR, "..", "..", "assets", "templates");
const BACKUP_WARNING = "Before upgrading an existing Personal OS data directory, create a complete independent backup or snapshot and verify that it can be restored.";

function without(values, removed) {
  return (Array.isArray(values) ? values : []).filter((item) => !removed.has(item));
}

function upgradedPolicy(policy) {
  const autoWrite = without(policy.autoWrite, new Set(["99_AI/runs/**"]));
  if (!autoWrite.includes("99_AI/hosts/*/runs/**")) autoWrite.push("99_AI/hosts/*/runs/**");
  const ignoreIndex = without(policy.ignoreIndex, new Set(["99_AI/agents/**", "99_AI/proposed/**", "99_AI/runs/**", "99_AI/trash/**"]));
  if (!ignoreIndex.includes("99_AI/**")) ignoreIndex.push("99_AI/**");
  return { ...policy, autoWrite, ignoreIndex };
}

async function acquireUpgradeLock(root) {
  const lockPath = path.join(root, ".pos", "lock");
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ operation: "workspace-upgrade", pid: process.pid, createdAt: isoNow() })}\n`);
    await handle.sync();
    await handle.close();
    return lockPath;
  } catch (error) {
    if (error?.code === "EEXIST") throw new PosError("APPLY_LOCKED", "Another apply, undo, or workspace upgrade is active.", { lock: ".pos/lock" }, 4);
    throw error;
  }
}

export async function createWorkspaceUpgradePlan(rootInput) {
  const { root, marker } = await openRoot(rootInput);
  const currentLayout = workspaceLayout(marker);
  if (currentLayout === AI_WORKSPACE_LAYOUT) {
    return {
      schema: "pos.workspace-upgrade-plan.v1",
      root,
      currentLayout,
      targetLayout: AI_WORKSPACE_LAYOUT,
      direction: "up-to-date",
      moves: [],
      creates: [],
      updates: [],
      conflicts: [],
      warning: BACKUP_WARNING,
    };
  }
  invariant(currentLayout === LEGACY_AI_WORKSPACE_LAYOUT, "UNSUPPORTED_AI_WORKSPACE_LAYOUT", "Unsupported Personal OS AI workspace layout.", { currentLayout }, 3);

  const candidates = [
    { from: "99_AI/runs", to: "99_AI/hosts/legacy/runs", meaning: "Historical Runs with unknown original host" },
    { from: "99_AI/agents", to: "99_AI/shared/legacy-roles", meaning: "Legacy copied logical Agent/Role definitions" },
    { from: "99_AI/proposed", to: "99_AI/shared/legacy-proposed", meaning: "Legacy root-level proposals" },
  ];
  const moves = [];
  const conflicts = [];
  for (const candidate of candidates) {
    await assertNoSymlinkComponents(root, candidate.from);
    await assertNoSymlinkComponents(root, candidate.to, { includeLeaf: false });
    const sourceExists = await exists(resolveInside(root, candidate.from));
    const targetExists = await exists(resolveInside(root, candidate.to));
    if (sourceExists && targetExists) conflicts.push({ code: "WORKSPACE_UPGRADE_TARGET_EXISTS", ...candidate });
    else if (sourceExists) moves.push(candidate);
    else if (targetExists) conflicts.push({ code: "WORKSPACE_UPGRADE_PARTIAL_LAYOUT", ...candidate });
  }

  const directoryCandidates = ["99_AI/hosts", "99_AI/hosts/legacy", "99_AI/shared", "99_AI/shared/handoffs", ".pos/workspace-upgrades"];
  const creates = [];
  for (const relative of directoryCandidates) {
    if (!(await exists(resolveInside(root, relative)))) creates.push({ type: "directory", path: relative });
  }
  for (const [relative, template] of [
    ["99_AI/CONTEXT.md", "AI_WORKSPACE_CONTEXT.md"],
    ["99_AI/hosts/legacy/CONTEXT.md", "HOST_CONTEXT.md"],
  ]) {
    if (!(await exists(resolveInside(root, relative)))) creates.push({ type: "file", path: relative, template });
  }

  const policy = await readJson(resolveInside(root, ".pos/policy.json"));
  return {
    schema: "pos.workspace-upgrade-plan.v1",
    root,
    currentLayout,
    targetLayout: AI_WORKSPACE_LAYOUT,
    direction: "upgrade",
    moves,
    creates,
    updates: [
      { path: ".pos/policy.json", summary: "Route automatic Run writes and index exclusion to host-isolated workspaces." },
      { path: ".pos/project.json", summary: "Record the host-workspace layout marker after successful migration." },
    ],
    conflicts,
    nextPolicy: upgradedPolicy(policy),
    warning: BACKUP_WARNING,
    requiresApproval: true,
    dataBoundary: `Reads and writes only the explicit Personal OS root: ${root}`,
  };
}

async function removeCreatedDirectories(root, createdDirectories) {
  for (const relative of [...createdDirectories].reverse()) {
    try {
      await rmdir(resolveInside(root, relative));
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    }
  }
}

export async function upgradeWorkspace(rootInput, options = {}) {
  const plan = await createWorkspaceUpgradePlan(rootInput);
  if (plan.direction === "up-to-date") return { applied: false, upToDate: true, plan };
  invariant(plan.conflicts.length === 0, "WORKSPACE_UPGRADE_CONFLICT", "Legacy AI workspace cannot be upgraded until conflicting partial targets are resolved.", { conflicts: plan.conflicts }, 4);
  if (options.yes !== true) return { applied: false, requiresApproval: true, plan };

  const { root } = plan;
  let lockPath = null;
  const moved = [];
  const createdFiles = [];
  const createdDirectories = [];
  const previousMarker = await readJson(resolveInside(root, ".pos/project.json"));
  const previousPolicy = await readJson(resolveInside(root, ".pos/policy.json"));
  const transactionId = `${new Date().toISOString().replace(/[-:.]/gu, "").slice(0, 15)}-host-workspaces-${randomUUID().slice(0, 8)}`;
  const transactionRelative = `.pos/workspace-upgrades/${transactionId}`;
  try {
    lockPath = await acquireUpgradeLock(root);
    await ensureDir(resolveInside(root, ".pos/workspace-upgrades"));
    if (plan.creates.some((item) => item.type === "directory" && item.path === ".pos/workspace-upgrades")) createdDirectories.push(".pos/workspace-upgrades");
    await ensureDir(resolveInside(root, transactionRelative));
    createdDirectories.push(transactionRelative);
    await writeJsonAtomic(resolveInside(root, `${transactionRelative}/plan.json`), plan);
    await writeJsonAtomic(resolveInside(root, `${transactionRelative}/before-project.json`), previousMarker);
    await writeJsonAtomic(resolveInside(root, `${transactionRelative}/before-policy.json`), previousPolicy);

    for (const item of plan.creates.filter((entry) => entry.type === "directory" && entry.path !== ".pos/workspace-upgrades")) {
      await ensureDir(resolveInside(root, item.path));
      createdDirectories.push(item.path);
    }
    for (const item of plan.creates.filter((entry) => entry.type === "file")) {
      let content = await readFile(path.join(TEMPLATE_DIR, item.template), "utf8");
      if (item.template === "HOST_CONTEXT.md") content = content.replaceAll("{{host_id}}", "legacy");
      await atomicWrite(resolveInside(root, item.path), content);
      createdFiles.push(item.path);
    }

    for (const item of plan.moves) {
      await ensureDir(path.dirname(resolveInside(root, item.to)));
      await rename(resolveInside(root, item.from), resolveInside(root, item.to));
      moved.push(item);
      if (Number(process.env.POS_TEST_FAIL_WORKSPACE_UPGRADE_AFTER_MOVES ?? 0) === moved.length) {
        throw new PosError("INJECTED_WORKSPACE_UPGRADE_FAILURE", "Synthetic workspace-upgrade failure.", { moved: moved.length }, 5);
      }
    }

    await writeJsonAtomic(resolveInside(root, ".pos/policy.json"), plan.nextPolicy);
    const upgradedAt = isoNow();
    await writeJsonAtomic(resolveInside(root, ".pos/project.json"), {
      ...previousMarker,
      aiWorkspaceLayout: AI_WORKSPACE_LAYOUT,
      aiWorkspaceUpgradedAt: upgradedAt,
    });
    await writeJsonAtomic(resolveInside(root, `${transactionRelative}/result.json`), {
      schema: "pos.workspace-upgrade-result.v1",
      status: "completed",
      upgradedAt,
      moves: moved,
    });
    return {
      schema: "pos.workspace-upgrade-result.v1",
      applied: true,
      root,
      previousLayout: plan.currentLayout,
      layout: AI_WORKSPACE_LAYOUT,
      moves: moved,
      transaction: transactionRelative,
      warning: BACKUP_WARNING,
      next: "Start a new Agent Run with an explicit --host when available; historical Runs remain under host `legacy`.",
    };
  } catch (error) {
    const recoveryErrors = [];
    try {
      await writeJsonAtomic(resolveInside(root, ".pos/project.json"), previousMarker);
      await writeJsonAtomic(resolveInside(root, ".pos/policy.json"), previousPolicy);
    } catch (restoreError) {
      recoveryErrors.push({ phase: "restore-control-files", message: restoreError instanceof Error ? restoreError.message : String(restoreError) });
    }
    for (const item of [...moved].reverse()) {
      try {
        invariant(!(await exists(resolveInside(root, item.from))), "WORKSPACE_UPGRADE_RECOVERY_CONFLICT", "Legacy source path reappeared during upgrade recovery.", item, 5);
        await ensureDir(path.dirname(resolveInside(root, item.from)));
        await rename(resolveInside(root, item.to), resolveInside(root, item.from));
      } catch (restoreError) {
        recoveryErrors.push({ phase: "restore-move", item, message: restoreError instanceof Error ? restoreError.message : String(restoreError) });
      }
    }
    for (const relative of createdFiles.reverse()) {
      try {
        await rm(resolveInside(root, relative), { force: true });
      } catch (restoreError) {
        recoveryErrors.push({ phase: "remove-created-file", path: relative, message: restoreError instanceof Error ? restoreError.message : String(restoreError) });
      }
    }
    try {
      await removeCreatedDirectories(root, createdDirectories.filter((item) => item !== transactionRelative));
    } catch (restoreError) {
      recoveryErrors.push({ phase: "remove-created-directories", message: restoreError instanceof Error ? restoreError.message : String(restoreError) });
    }
    if (recoveryErrors.length) {
      throw new PosError("WORKSPACE_UPGRADE_RECOVERY_FAILED", "AI workspace upgrade failed and could not fully restore the previous layout.", { cause: error instanceof Error ? error.message : String(error), recoveryErrors, transaction: transactionRelative }, 5);
    }
    throw error;
  } finally {
    if (lockPath) await rm(lockPath, { force: true });
  }
}
