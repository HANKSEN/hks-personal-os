import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { diagnose } from "./doctor.mjs";
import { invariant } from "./errors.mjs";
import { exists, readJson } from "./io.mjs";
import { initializeRoot, openRoot } from "./root.mjs";

export const SETUP_SCHEMA = "personal-os.setup.v1";

export const BACKUP_WARNING = "Before authorizing an Agent to read valuable existing files, create an independent full-directory backup or snapshot and verify that selected files can be restored. Personal OS history, Undo, Git, and cloud version history are additional recovery layers, not backup replacements.";

function rootLike(target) {
  return target === path.parse(target).root;
}

export async function inspectWorkspacePath(rootInput) {
  invariant(typeof rootInput === "string" && rootInput.trim(), "ROOT_REQUIRED", "An explicit workspace path is required.", undefined, 3);
  const requested = path.resolve(rootInput);
  invariant(!rootLike(requested), "UNSAFE_WORKSPACE_ROOT", "Filesystem root cannot be used as a Personal OS workspace.", { path: requested }, 3);

  if (!(await exists(requested))) {
    return { path: requested, state: "missing", safeForInitialization: true };
  }

  const info = await lstat(requested);
  if (info.isSymbolicLink()) {
    return { path: requested, state: "symlink", safeForInitialization: false, reason: "Workspace roots may not be symbolic links." };
  }
  if (!info.isDirectory()) {
    return { path: requested, state: "not-directory", safeForInitialization: false, reason: "Workspace root must be a directory." };
  }

  const markerPath = path.join(requested, ".pos", "project.json");
  if (await exists(markerPath)) {
    try {
      const marker = await readJson(markerPath);
      if (marker?.schema === "pos.project.v1" && typeof marker.projectId === "string") {
        return { path: requested, state: "initialized", safeForInitialization: false, projectId: marker.projectId };
      }
      return { path: requested, state: "invalid-personal-os", safeForInitialization: false, reason: "The Personal OS root marker is invalid." };
    } catch (error) {
      return { path: requested, state: "invalid-personal-os", safeForInitialization: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const entries = await readdir(requested);
  if (entries.length === 0) return { path: requested, state: "empty", safeForInitialization: true };
  return {
    path: requested,
    state: "non-empty",
    safeForInitialization: false,
    entryCount: entries.length,
    reason: "A non-empty directory must use the existing-directory audit journey; initialization never takes it over.",
  };
}

export function setupEnvelope({
  state,
  journey = null,
  installation = null,
  workspace = null,
  completed = [],
  pendingAuthorization = null,
  health = null,
  nextAction = null,
  issues = [],
  onboarding = null,
}) {
  return {
    schema: SETUP_SCHEMA,
    state,
    journey,
    installation,
    workspace,
    completed,
    pendingAuthorization,
    health,
    nextAction,
    issues,
    onboarding,
  };
}

export async function initializeWorkspace(rootInput, { areas = [], mode = "collaborative" } = {}) {
  const candidate = await inspectWorkspacePath(rootInput);
  invariant(candidate.safeForInitialization, "WORKSPACE_NOT_EMPTY", "Only a missing or empty directory can be initialized. Use the existing-directory journey for non-empty directories.", candidate, 3);
  const parent = path.dirname(candidate.path);
  const parentInfo = await lstat(parent).catch(() => null);
  invariant(parentInfo?.isDirectory() && !parentInfo.isSymbolicLink(), "WORKSPACE_PARENT_INVALID", "The parent directory for a new Personal OS must already exist and must not be a symbolic link.", { parent }, 3);
  const staging = path.join(parent, `.personal-os-init-${path.basename(candidate.path)}-${process.pid}-${randomBytes(5).toString("hex")}`);
  let committed = false;
  try {
    const initialized = await initializeRoot(staging, { areas, mode });
    const stagedHealth = await diagnose(initialized.root);
    invariant(stagedHealth.healthy, "INITIALIZED_ROOT_UNHEALTHY", "Staged Personal OS initialization failed health validation.", { staging, health: stagedHealth }, 5);
    if (process.env.POS_TEST_FAIL_SETUP_AFTER_STAGE === "1") {
      throw new Error("Synthetic setup failure after staging.");
    }

    const current = await inspectWorkspacePath(candidate.path);
    invariant(current.state === candidate.state && current.safeForInitialization, "WORKSPACE_CHANGED_DURING_INITIALIZATION", "The selected workspace changed while initialization was being prepared.", { before: candidate, after: current }, 4);
    if (current.state === "empty") await rmdir(candidate.path);
    await rename(staging, candidate.path);
    committed = true;

    const root = await openRoot(candidate.path);
    const health = await diagnose(root.root);
    invariant(health.healthy, "INITIALIZED_ROOT_UNHEALTHY", "Personal OS initialization completed but health validation failed.", { root: root.root, health }, 5);
    return { initialized: { ...initialized, root: root.root }, health };
  } catch (error) {
    if (!committed) {
      await rm(staging, { recursive: true, force: true });
      if (candidate.state === "empty" && !(await exists(candidate.path))) await mkdir(candidate.path);
    }
    throw error;
  }
}

export function onboardingResult(root, { firstTask = false } = {}) {
  return {
    root,
    guide: path.join(root, "START_HERE.md"),
    firstTaskCompleted: Boolean(firstTask),
    naturalLanguageStarts: [
      "把这份内容当成一个新输入，帮我判断应该怎么处理。",
      "继续推进我正在做的这件事，只读取必要的上下文。",
      "复盘这次行动，把事实、经验和可复用方法分开。",
    ],
  };
}

export function nextForCandidate(candidate, installation, requestedJourney = "new") {
  if (candidate.state === "initialized") {
    return setupEnvelope({
      state: "HEALTH_CHECK",
      journey: "new",
      installation,
      workspace: { candidateRoot: candidate.path, candidateState: candidate.state, authorizedAccess: "none" },
      completed: ["PREFLIGHT", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_NEW_ROOT"],
      nextAction: { type: "diagnose-existing-root", root: candidate.path },
    });
  }
  if (candidate.safeForInitialization) {
    return setupEnvelope({
      state: "WAIT_ROOT_CONFIRMATION",
      journey: requestedJourney,
      installation,
      workspace: { candidateRoot: candidate.path, candidateState: candidate.state, authorizedAccess: "none" },
      completed: ["PREFLIGHT", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_NEW_ROOT"],
      pendingAuthorization: { operation: "initialize-new-root", path: candidate.path, access: "write" },
      nextAction: { type: "ask-user", promptKey: "confirm-new-root" },
    });
  }
  if (candidate.state === "non-empty") {
    return setupEnvelope({
      state: "WAIT_EXISTING_SOURCE_CONFIRMATION",
      journey: "existing",
      installation,
      workspace: { sourceRoot: candidate.path, sourceState: candidate.state, authorizedAccess: "none" },
      completed: ["PREFLIGHT", "INSTALL_SKILL", "VERIFY_SKILL", "RESOLVE_SOURCE_ROOT"],
      pendingAuthorization: { operation: "audit-source-readonly", path: candidate.path, access: "read" },
      nextAction: { type: "ask-user", promptKey: "confirm-existing-source-and-backup" },
      issues: [{ code: "NON_EMPTY_ROOT_ROUTED_TO_AUDIT", message: candidate.reason }],
    });
  }
  return setupEnvelope({
    state: "RECOVERABLE_FAILURE",
    journey: requestedJourney,
    installation,
    workspace: { candidateRoot: candidate.path, candidateState: candidate.state, authorizedAccess: "none" },
    nextAction: { type: "choose-another-root" },
    issues: [{ code: "UNSAFE_WORKSPACE_CANDIDATE", message: candidate.reason ?? "Workspace candidate cannot be used safely." }],
  });
}
