import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PosError, invariant } from "./errors.mjs";
import { atomicWrite, ensureDir, exists } from "./io.mjs";
import { assertNoSymlinkComponents, normalizeRelative, resolveInside, safeComponent } from "./safe-path.mjs";

export const AI_WORKSPACE_LAYOUT = "pos.ai-workspace.hosts.v1";
export const LEGACY_AI_WORKSPACE_LAYOUT = "pos.ai-workspace.legacy.v1";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(CURRENT_DIR, "..", "..");
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, "assets", "templates");
const ROLE_DIR = path.join(PACKAGE_ROOT, "assets", "roles");
const HOST_ALIASES = new Map([
  ["claude", "claude-code"],
  ["claudecode", "claude-code"],
  ["kimi", "kimi-agent"],
  ["q-code", "qcode"],
]);

function stableId(value, label) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-");
  safeComponent(normalized, label);
  invariant(/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(normalized), "INVALID_COMPONENT", `${label} must be a stable lowercase ASCII identifier.`, { value }, 2);
  return normalized;
}

export function resolveHostId(explicit, environment = process.env) {
  const stable = stableId(explicit ?? environment.PERSONAL_OS_HOST ?? "generic", "Host ID");
  return HOST_ALIASES.get(stable) ?? stable;
}

export function resolveRoleId(explicit) {
  return stableId(explicit ?? "orchestrator", "Role ID");
}

export function roleProfileRelative(roleIdInput) {
  const roleId = resolveRoleId(roleIdInput);
  return `assets/roles/${roleId}/ROLE.md`;
}

export async function loadRoleProfile(roleIdInput) {
  const roleId = resolveRoleId(roleIdInput);
  const absolute = path.join(ROLE_DIR, roleId, "ROLE.md");
  invariant(await exists(absolute), "ROLE_NOT_FOUND", "Requested Personal OS Role Profile is not installed.", { roleId }, 2);
  return {
    roleId,
    path: `skill://roles/${roleId}.md`,
    absolute,
    content: await readFile(absolute, "utf8"),
  };
}

export function workspaceLayout(marker) {
  return marker?.aiWorkspaceLayout ?? LEGACY_AI_WORKSPACE_LAYOUT;
}

export function requireModernWorkspace(marker) {
  if (workspaceLayout(marker) !== AI_WORKSPACE_LAYOUT) {
    throw new PosError("WORKSPACE_UPGRADE_REQUIRED", "This Personal OS uses the legacy shared AI workspace. Preview and approve `pos workspace-upgrade <root>` before creating new Runs.", {
      current: workspaceLayout(marker),
      required: AI_WORKSPACE_LAYOUT,
    }, 3);
  }
}

export function hostRootRelative(hostIdInput) {
  const hostId = resolveHostId(hostIdInput, {});
  return `99_AI/hosts/${hostId}`;
}

export function runRootRelative(hostIdInput, taskIdInput) {
  const hostId = resolveHostId(hostIdInput, {});
  const taskId = safeComponent(String(taskIdInput), "Task ID");
  return `99_AI/hosts/${hostId}/runs/${taskId}`;
}

export function runLocationFromRelative(relativeInput, expectedTaskId = null) {
  const relative = normalizeRelative(relativeInput);
  const parts = relative.split("/");
  let hostId;
  let taskId;
  let runRelative;
  let legacy = false;
  if (parts[0] === "99_AI" && parts[1] === "hosts" && parts[2] && parts[3] === "runs" && parts[4]) {
    hostId = resolveHostId(parts[2], {});
    invariant(hostId === parts[2], "INVALID_RUN_PATH", "AI Run path must use the canonical Host ID.", { path: relative, host: parts[2], canonicalHost: hostId }, 3);
    taskId = safeComponent(parts[4], "Task ID");
    runRelative = parts.slice(0, 5).join("/");
  } else if (parts[0] === "99_AI" && parts[1] === "runs" && parts[2]) {
    hostId = "legacy";
    taskId = safeComponent(parts[2], "Task ID");
    runRelative = parts.slice(0, 3).join("/");
    legacy = true;
  } else {
    throw new PosError("INVALID_RUN_PATH", "Path does not belong to a Personal OS AI Run.", { path: relative }, 3);
  }
  invariant(!expectedTaskId || taskId === expectedTaskId, "CHANGESET_TASK_LOCATION_MISMATCH", "AI Run path does not match its referenced Task ID.", { expectedTaskId, taskId, path: relative }, 3);
  return { hostId, taskId, runRelative, legacy, relative };
}

export async function initializeAIWorkspace(root) {
  for (const relative of ["99_AI/hosts", "99_AI/shared/handoffs", "99_AI/trash"]) {
    await assertNoSymlinkComponents(root, relative, { includeLeaf: false });
    await ensureDir(resolveInside(root, relative));
  }
  const contextRelative = "99_AI/CONTEXT.md";
  if (!(await exists(resolveInside(root, contextRelative)))) {
    await atomicWrite(resolveInside(root, contextRelative), await readFile(path.join(TEMPLATE_DIR, "AI_WORKSPACE_CONTEXT.md"), "utf8"));
  }
}

export async function ensureHostWorkspace(root, hostIdInput) {
  const hostId = resolveHostId(hostIdInput, {});
  const hostRelative = hostRootRelative(hostId);
  for (const relative of [hostRelative, `${hostRelative}/runs`]) {
    await assertNoSymlinkComponents(root, relative, { includeLeaf: false });
    await ensureDir(resolveInside(root, relative));
  }
  const contextRelative = `${hostRelative}/CONTEXT.md`;
  await assertNoSymlinkComponents(root, contextRelative, { includeLeaf: false });
  if (!(await exists(resolveInside(root, contextRelative)))) {
    const template = await readFile(path.join(TEMPLATE_DIR, "HOST_CONTEXT.md"), "utf8");
    await atomicWrite(resolveInside(root, contextRelative), template.replaceAll("{{host_id}}", hostId));
  }
  return { hostId, hostRelative, contextRelative, runsRelative: `${hostRelative}/runs` };
}
