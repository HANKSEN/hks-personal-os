import { createHash } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { PosError, invariant } from "./errors.mjs";
import {
  appendJsonl,
  atomicCreate,
  atomicWrite,
  copyPath,
  dateStamp,
  ensureDir,
  exists,
  hashPath,
  isoNow,
  lstatMaybe,
  readJson,
  removePath,
  sha256File,
  sha256Text,
  writeJsonAtomic,
} from "./io.mjs";
import { buildIndex } from "./indexer.mjs";
import { assertWritePolicy, isAutoWrite, isProtected, isWriteAllowed, loadPolicy } from "./policy.mjs";
import { openRoot } from "./root.mjs";
import { assertNoSymlinkComponents, matchesAny, normalizeRelative, resolveInside, safeComponent } from "./safe-path.mjs";

const ACTIONS = new Set(["create", "update", "move", "archive", "trash"]);
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

function relativeChangesetPath(root, input) {
  const absolute = path.isAbsolute(input) ? path.resolve(input) : resolveInside(root, input);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  invariant(relative && !relative.startsWith("../") && !path.isAbsolute(relative), "CHANGESET_OUTSIDE_ROOT", "Changeset file must be inside the Personal OS root.", { input }, 3);
  const normalized = normalizeRelative(relative);
  invariant(matchesAny(normalized, ["99_AI/runs/**", "99_AI/proposed/**"]), "CHANGESET_LOCATION_REJECTED", "Changeset must live in the AI workspace.", { path: normalized }, 3);
  return { absolute, relative: normalized };
}

function checkScope(relative, scope) {
  invariant(matchesAny(relative, scope), "WRITE_SCOPE_VIOLATION", "Operation is outside the Changeset write scope.", { path: relative, writeScope: scope }, 3);
}

function ensureNoOverlap(paths) {
  const sorted = paths
    .map((original) => ({ original, key: original.normalize("NFKC").toLowerCase() }))
    .sort((left, right) => left.key.localeCompare(right.key, "en"));
  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      if (sorted[right].key === sorted[left].key || sorted[right].key.startsWith(`${sorted[left].key}/`)) {
        throw new PosError("OVERLAPPING_OPERATIONS", "Changeset operations overlap or alias the same path tree.", { paths: [sorted[left].original, sorted[right].original] }, 3);
      }
    }
  }
}

async function validateNewContainerContexts(root, operations) {
  const createdPaths = new Set(
    operations.filter((operation) => operation.action === "create").map((operation) => operation.path),
  );
  const checked = new Set();
  for (const operation of operations) {
    const destination = operation.path;
    if (!destination) continue;
    const parts = destination.split("/");
    const top = parts[0];
    if (!["10_Projects", "20_Areas"].includes(top) || parts.length < 3) continue;
    const container = `${top}/${parts[1]}`;
    if (checked.has(container) || (await exists(resolveInside(root, container)))) continue;
    checked.add(container);
    invariant(
      createdPaths.has(`${container}/CONTEXT.md`),
      "CONTEXT_REQUIRED_FOR_NEW_CONTAINER",
      "A new Area or Project must create its CONTEXT.md in the same Changeset.",
      { container },
      3,
    );
  }
}

async function revalidateOperation(root, operation) {
  if (operation.action === "create") {
    await assertNoSymlinkComponents(root, operation.path, { includeLeaf: false });
    invariant(!(await exists(resolveInside(root, operation.path))), "TARGET_EXISTS", "Create target appeared after planning.", { path: operation.path }, 4);
    return;
  }
  if (operation.action === "update") {
    await assertNoSymlinkComponents(root, operation.path);
    const current = await hashPath(resolveInside(root, operation.path));
    invariant(current === `file:${operation.beforeHash}`, "STALE_CONTENT", "Update target changed after planning.", { path: operation.path, expected: operation.beforeHash, actual: current }, 4);
    return;
  }
  await assertNoSymlinkComponents(root, operation.from);
  await assertNoSymlinkComponents(root, operation.path, { includeLeaf: false });
  const current = await hashPath(resolveInside(root, operation.from));
  invariant(current === operation.beforeHash, "STALE_CONTENT", "Operation source changed after planning.", { path: operation.from, expected: operation.beforeHash, actual: current }, 4);
  invariant(!(await exists(resolveInside(root, operation.path))), "TARGET_EXISTS", "Operation destination appeared after planning.", { path: operation.path }, 4);
}

async function revalidatePlan(root, plan) {
  for (const operation of plan.operations) {
    await revalidateOperation(root, operation);
  }
}

function validateHistorySnapshots(manifest) {
  invariant(Array.isArray(manifest?.snapshots) && manifest.snapshots.length > 0, "INVALID_HISTORY", "History snapshots are missing.", undefined, 3);
  const snapshots = manifest.snapshots.map((snapshot) => {
    invariant(snapshot && typeof snapshot === "object", "INVALID_HISTORY", "Invalid history snapshot.", undefined, 3);
    const relative = normalizeRelative(snapshot.path);
    const existed = snapshot.existed === true;
    const backup = existed ? normalizeRelative(String(snapshot.backup ?? "")) : null;
    if (existed) {
      invariant(backup === `before/${relative}`, "INVALID_HISTORY", "History backup path does not match its asset path.", { path: relative, backup }, 3);
    }
    invariant(snapshot.afterHash === null || typeof snapshot.afterHash === "string", "INVALID_HISTORY", "Invalid history after hash.", { path: relative }, 3);
    return { ...snapshot, path: relative, existed, backup };
  });
  ensureNoOverlap(snapshots.map((snapshot) => snapshot.path));
  return snapshots;
}

function historySealPayload(manifest) {
  return {
    schema: manifest.schema,
    taskId: manifest.taskId,
    planDigest: manifest.planDigest,
    changesetPath: manifest.changesetPath,
    operations: (manifest.operations ?? []).map((operation) => ({
      id: operation.id,
      action: operation.action,
      from: operation.from ?? null,
      path: operation.path ?? null,
      reason: operation.reason ?? "",
      expectedHash: operation.expectedHash ?? null,
      beforeHash: operation.beforeHash ?? null,
      afterHash: operation.afterHash ?? null,
      protected: operation.protected === true,
      autoWrite: operation.autoWrite === true,
    })),
    snapshots: (manifest.snapshots ?? []).map((snapshot) => ({
      path: snapshot.path,
      existed: snapshot.existed === true,
      beforeHash: snapshot.beforeHash ?? null,
      backup: snapshot.backup ?? null,
      afterHash: snapshot.afterHash ?? null,
    })),
  };
}

function historySealDigest(manifest) {
  return sha256Text(JSON.stringify(historySealPayload(manifest)));
}

async function verifyHistory(root, taskId, historyRoot, manifest) {
  invariant(manifest?.schema === "pos.history.v1" && manifest.taskId === taskId, "INVALID_HISTORY", "History manifest identity does not match the requested task.", { taskId, manifestTaskId: manifest?.taskId }, 3);
  invariant(typeof manifest.planDigest === "string" && Array.isArray(manifest.operations), "INVALID_HISTORY", "History manifest is missing its plan or operations.", { taskId }, 3);
  const snapshots = validateHistorySnapshots(manifest);
  const expectedPaths = manifest.operations.flatMap((operation) => [operation.from, operation.path].filter(Boolean));
  ensureNoOverlap(expectedPaths);
  const expected = [...expectedPaths].sort();
  const actual = snapshots.map((snapshot) => snapshot.path).sort();
  invariant(JSON.stringify(actual) === JSON.stringify(expected), "INVALID_HISTORY", "History snapshots do not match the applied operation paths.", { expected, actual }, 3);

  const sealRelative = `.pos/transactions/${taskId}.json`;
  await assertNoSymlinkComponents(root, sealRelative);
  const sealPath = resolveInside(root, sealRelative);
  invariant(await exists(sealPath), "HISTORY_SEAL_MISSING", "History integrity seal is missing.", { taskId }, 3);
  const seal = await readJson(sealPath);
  const digest = historySealDigest({ ...manifest, snapshots });
  invariant(seal?.schema === "pos.transaction-seal.v1" && seal.taskId === taskId && seal.digest === digest && manifest.sealDigest === digest, "HISTORY_INTEGRITY_FAILURE", "History manifest no longer matches its transaction seal.", { taskId }, 3);

  for (const snapshot of snapshots) {
    if (!snapshot.existed) {
      invariant(snapshot.beforeHash === null && snapshot.backup === null, "INVALID_HISTORY", "A non-existing path cannot have a backup.", { path: snapshot.path }, 3);
      continue;
    }
    invariant(typeof snapshot.beforeHash === "string", "INVALID_HISTORY", "Existing snapshot is missing its before hash.", { path: snapshot.path }, 3);
    const backupRelative = `.pos/history/${taskId}/${snapshot.backup}`;
    await assertNoSymlinkComponents(root, backupRelative);
    const backupHash = await hashPath(resolveInside(root, backupRelative));
    invariant(backupHash === snapshot.beforeHash, "HISTORY_BACKUP_TAMPERED", "History backup content does not match its recorded hash.", { path: snapshot.path, expected: snapshot.beforeHash, actual: backupHash }, 3);
  }
  return snapshots;
}

function diffText(before, after, label) {
  if (before === after) return `--- ${label}\n+++ ${label}\n(no content change)`;
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix).slice(0, 120).map((line) => `-${line}`);
  const added = afterLines.slice(prefix, afterLines.length - suffix).slice(0, 120).map((line) => `+${line}`);
  return [`--- ${label}`, `+++ ${label}`, `@@ line ${prefix + 1} @@`, ...removed, ...added].join("\n");
}

async function loadContent(root, taskId, operation) {
  const hasInline = Object.hasOwn(operation, "content");
  const hasSource = typeof operation.source === "string" && operation.source.length > 0;
  invariant(hasInline !== hasSource, "INVALID_OPERATION_CONTENT", "Create/update requires exactly one of content or source.", { operation: operation.id }, 2);
  if (hasInline) {
    const content = String(operation.content);
    invariant(Buffer.byteLength(content) <= MAX_CONTENT_BYTES, "CONTENT_TOO_LARGE", "Proposed content exceeds the v1 size limit.", { operation: operation.id }, 2);
    return content;
  }
  const source = normalizeRelative(operation.source);
  invariant(source.startsWith(`99_AI/runs/${taskId}/proposed/`), "INVALID_PROPOSAL_SOURCE", "Proposed content must be inside the current Run's proposed directory.", { source }, 3);
  await assertNoSymlinkComponents(root, source);
  const absolute = resolveInside(root, source);
  const info = await lstatMaybe(absolute);
  invariant(info?.isFile(), "PROPOSAL_SOURCE_MISSING", "Proposed content file does not exist or is not a regular file.", { source }, 3);
  invariant(info.size <= MAX_CONTENT_BYTES, "CONTENT_TOO_LARGE", "Proposed content exceeds the v1 size limit.", { source }, 2);
  return readFile(absolute, "utf8");
}

export async function planChangeset(rootInput, changesetInput) {
  const { root, marker } = await openRoot(rootInput);
  const policy = await loadPolicy(root);
  const changesetPath = relativeChangesetPath(root, changesetInput);
  await assertNoSymlinkComponents(root, changesetPath.relative);
  const changeset = await readJson(changesetPath.absolute);
  invariant(changeset?.schema === "pos.changeset.v1", "INVALID_CHANGESET", "Unsupported Changeset schema.", { schema: changeset?.schema }, 2);
  const taskId = safeComponent(changeset.taskId, "Task ID");
  invariant(changesetPath.relative.startsWith(`99_AI/runs/${taskId}/`), "CHANGESET_TASK_LOCATION_MISMATCH", "Changeset must live inside the AI Run it references.", { taskId, path: changesetPath.relative }, 3);
  const writeScope = Array.isArray(changeset.writeScope) ? changeset.writeScope.map((item) => normalizeRelative(String(item), { allowEmpty: true })) : [];
  invariant(writeScope.length > 0, "WRITE_SCOPE_REQUIRED", "Changeset must declare a write scope.", undefined, 2);
  const taskRelative = `99_AI/runs/${taskId}/task.json`;
  await assertNoSymlinkComponents(root, taskRelative);
  const taskPath = resolveInside(root, taskRelative);
  invariant(await exists(taskPath), "TASK_NOT_FOUND", "Changeset must reference an existing AI Run task.", { taskId }, 3);
  const task = await readJson(taskPath);
  invariant(task?.id === taskId && task?.schema === "pos.task.v1", "TASK_MISMATCH", "Changeset task does not match its AI Run.", { taskId }, 3);
  const taskWriteScope = Array.isArray(task.writeScope) ? task.writeScope.map((item) => normalizeRelative(String(item), { allowEmpty: true })) : [];
  invariant(taskWriteScope.length > 0, "TASK_WRITE_SCOPE_REQUIRED", "Task Card must declare a write scope.", { taskId }, 3);
  invariant(Array.isArray(changeset.operations), "INVALID_CHANGESET", "Changeset operations must be an array.", undefined, 2);
  invariant(changeset.operations.length <= Number(policy.maxOperations ?? 25), "TOO_MANY_OPERATIONS", "Changeset exceeds the configured operation limit.", { count: changeset.operations.length }, 3);

  const ids = new Set();
  const affected = [];
  const operations = [];
  const today = dateStamp();

  for (const raw of changeset.operations) {
    invariant(raw && typeof raw === "object", "INVALID_OPERATION", "Changeset operation must be an object.", undefined, 2);
    const id = safeComponent(raw.id, "Operation ID");
    invariant(!ids.has(id), "DUPLICATE_OPERATION_ID", "Operation IDs must be unique.", { id }, 2);
    ids.add(id);
    const action = String(raw.action ?? "");
    invariant(ACTIONS.has(action), "UNSUPPORTED_ACTION", "Unsupported Changeset action.", { action }, 2);
    let from = raw.from ? normalizeRelative(raw.from) : null;
    let destination = raw.path ? normalizeRelative(raw.path) : null;
    let content = null;
    let beforeHash = null;
    let afterHash = null;
    let diff = null;

    if (action === "create" || action === "update") {
      invariant(destination, "TARGET_REQUIRED", "Create/update requires a target path.", { id }, 2);
      checkScope(destination, writeScope);
      checkScope(destination, taskWriteScope);
      invariant(isWriteAllowed(policy, destination), "WRITE_NOT_ALLOWED", "Policy does not allow the target path.", { path: destination }, 3);
      await assertNoSymlinkComponents(root, destination, { includeLeaf: action === "update" });
      const target = resolveInside(root, destination);
      const targetInfo = await lstatMaybe(target);
      if (action === "create") invariant(!targetInfo, "TARGET_EXISTS", "Create target already exists.", { path: destination }, 4);
      else invariant(targetInfo?.isFile(), "UPDATE_TARGET_MISSING", "Update target must be an existing regular file.", { path: destination }, 4);
      content = await loadContent(root, taskId, raw);
      afterHash = sha256Text(content);
      if (action === "update") {
        beforeHash = await sha256File(target);
        if (raw.expectedHash) invariant(raw.expectedHash === beforeHash, "STALE_CONTENT", "Update target no longer matches the expected hash.", { path: destination, expected: raw.expectedHash, actual: beforeHash }, 4);
        diff = diffText(await readFile(target, "utf8"), content, destination);
      } else {
        diff = diffText("", content, destination);
      }
      affected.push(destination);
    } else {
      invariant(from, "SOURCE_REQUIRED", `${action} requires a source path.`, { id }, 2);
      checkScope(from, writeScope);
      checkScope(from, taskWriteScope);
      invariant(isWriteAllowed(policy, from), "WRITE_NOT_ALLOWED", "Policy does not allow mutating the source path.", { path: from }, 3);
      await assertNoSymlinkComponents(root, from);
      const source = resolveInside(root, from);
      invariant(await exists(source), "SOURCE_MISSING", "Operation source does not exist.", { path: from }, 4);
      beforeHash = await hashPath(source);
      if (raw.expectedHash) invariant(raw.expectedHash === beforeHash, "STALE_CONTENT", "Operation source no longer matches the expected hash.", { path: from, expected: raw.expectedHash, actual: beforeHash }, 4);
      if (action === "move") {
        invariant(destination, "TARGET_REQUIRED", "Move requires a target path.", { id }, 2);
      } else if (action === "archive") {
        destination = `90_Archive/${today}/${taskId}/${from}`;
      } else {
        destination = `99_AI/trash/${taskId}/${from}`;
      }
      destination = normalizeRelative(destination);
      checkScope(destination, writeScope);
      checkScope(destination, taskWriteScope);
      invariant(isWriteAllowed(policy, destination), "WRITE_NOT_ALLOWED", "Policy does not allow the destination path.", { path: destination }, 3);
      await assertNoSymlinkComponents(root, destination, { includeLeaf: false });
      invariant(!(await exists(resolveInside(root, destination))), "TARGET_EXISTS", "Operation destination already exists.", { path: destination }, 4);
      affected.push(from, destination);
      diff = `${action.toUpperCase()} ${from} -> ${destination}`;
    }

    operations.push({
      id,
      action,
      from,
      path: destination,
      reason: String(raw.reason ?? ""),
      expectedHash: raw.expectedHash ?? null,
      beforeHash,
      afterHash,
      content,
      diff,
      protected: [from, destination].filter(Boolean).some((item) => isProtected(policy, item)),
      autoWrite: [from, destination].filter(Boolean).every((item) => isAutoWrite(policy, item)),
    });
  }

  ensureNoOverlap(affected);
  await validateNewContainerContexts(root, operations);
  const digestInput = {
    projectId: marker.projectId,
    taskId,
    policyMode: policy.mode,
    writeScope,
    operations: operations.map(({ content, diff, ...operation }) => operation),
  };
  const planDigest = createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
  return {
    schema: "pos.plan.v1",
    projectId: marker.projectId,
    taskId,
    summary: String(changeset.summary ?? ""),
    changesetPath: changesetPath.relative,
    policyMode: policy.mode,
    writeScope,
    applicable: !(policy.mode === "safe" && operations.some((operation) => !operation.autoWrite)),
    requiresApproval: operations.some((operation) => !operation.autoWrite),
    requiresProtectedApproval: operations.some((operation) => operation.protected),
    operations,
    planDigest,
  };
}

export function publicPlan(plan) {
  return {
    ...plan,
    operations: plan.operations.map(({ content, ...operation }) => operation),
  };
}

async function acquireLock(root, taskId) {
  const lockPath = path.join(root, ".pos", "lock");
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ taskId, pid: process.pid, createdAt: isoNow() })}\n`);
    await handle.sync();
    await handle.close();
    return lockPath;
  } catch (error) {
    if (error?.code === "EEXIST") throw new PosError("APPLY_LOCKED", "Another apply or undo operation is active.", { lock: ".pos/lock" }, 4);
    throw error;
  }
}

async function snapshotAffected(root, historyRoot, affectedPaths) {
  const snapshots = [];
  for (const relative of affectedPaths) {
    await assertNoSymlinkComponents(root, relative);
    const absolute = resolveInside(root, relative);
    const existed = await exists(absolute);
    const snapshot = {
      path: relative,
      existed,
      beforeHash: existed ? await hashPath(absolute) : null,
      backup: existed ? `before/${relative}` : null,
      afterHash: null,
    };
    if (existed) await copyPath(absolute, path.join(historyRoot, snapshot.backup));
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function restoreSnapshots(root, historyRoot, snapshots) {
  for (const snapshot of snapshots) {
    await assertNoSymlinkComponents(root, snapshot.path);
    await removePath(resolveInside(root, snapshot.path));
  }
  for (const snapshot of snapshots) {
    if (snapshot.existed) {
      const backupAbsolute = path.join(historyRoot, snapshot.backup);
      const backupRelative = path.relative(root, backupAbsolute).split(path.sep).join("/");
      await assertNoSymlinkComponents(root, backupRelative);
      await assertNoSymlinkComponents(root, snapshot.path, { includeLeaf: false });
      await copyPath(backupAbsolute, resolveInside(root, snapshot.path));
    }
  }
}

async function executeOperation(root, operation) {
  if (operation.action === "create") {
    await atomicCreate(resolveInside(root, operation.path), operation.content);
    return;
  }
  if (operation.action === "update") {
    await atomicWrite(resolveInside(root, operation.path), operation.content);
    return;
  }
  const source = resolveInside(root, operation.from);
  const destination = resolveInside(root, operation.path);
  await ensureDir(path.dirname(destination));
  await rename(source, destination);
}

async function appendAudit(root, value) {
  await assertNoSymlinkComponents(root, ".pos/audit.jsonl");
  await appendJsonl(path.join(root, ".pos", "audit.jsonl"), value);
}

async function recordRejection(root, event, taskId, error) {
  await appendAudit(root, {
    schema: "pos.audit.v1",
    event,
    taskId: taskId ?? null,
    at: isoNow(),
    result: "rejected",
    error: {
      code: error?.code ?? "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

async function updateTaskStatus(root, taskId, status, extra = {}) {
  const taskRelative = `99_AI/runs/${taskId}/task.json`;
  await assertNoSymlinkComponents(root, taskRelative);
  const taskPath = resolveInside(root, taskRelative);
  if (!(await exists(taskPath))) return;
  const task = await readJson(taskPath);
  task.status = status;
  Object.assign(task, extra);
  task.updatedAt = isoNow();
  await writeJsonAtomic(taskPath, task);
}

export async function applyChangeset(rootInput, changesetInput, options = {}) {
  if (!options.yes) {
    const previewPlan = await planChangeset(rootInput, changesetInput);
    return { applied: false, preview: publicPlan(previewPlan) };
  }

  const { root } = await openRoot(rootInput);
  let lockPath = null;
  let historyRoot = null;
  let transactionSealPath = null;
  let plan = null;
  let manifest;
  const executedPaths = new Set();
  try {
    lockPath = await acquireLock(root, "apply");
    plan = await planChangeset(root, changesetInput);
    const policy = await loadPolicy(root);
    invariant(plan.operations.length > 0, "EMPTY_CHANGESET", "Changeset has no operations to apply.", undefined, 2);
    for (const operation of plan.operations) {
      for (const relative of [operation.from, operation.path].filter(Boolean)) {
        assertWritePolicy(policy, relative, { approved: true, approveProtected: Boolean(options.approveProtected) });
        await assertNoSymlinkComponents(root, relative, { includeLeaf: await exists(resolveInside(root, relative)) });
      }
    }
    await revalidatePlan(root, plan);

    historyRoot = path.join(root, ".pos", "history", plan.taskId);
    const transactionSealRelative = `.pos/transactions/${plan.taskId}.json`;
    await assertNoSymlinkComponents(root, transactionSealRelative);
    transactionSealPath = resolveInside(root, transactionSealRelative);
    invariant(!(await exists(historyRoot)), "TASK_ALREADY_APPLIED", "A history record already exists for this task.", { taskId: plan.taskId }, 4);
    invariant(!(await exists(transactionSealPath)), "TASK_ALREADY_APPLIED", "A transaction seal already exists for this task.", { taskId: plan.taskId }, 4);
    const affectedPaths = [...new Set(plan.operations.flatMap((operation) => [operation.from, operation.path].filter(Boolean)))];
    await ensureDir(historyRoot);
    const snapshots = await snapshotAffected(root, historyRoot, affectedPaths);
    manifest = {
      schema: "pos.history.v1",
      taskId: plan.taskId,
      planDigest: plan.planDigest,
      phase: "prepared",
      appliedAt: null,
      undoneAt: null,
      changesetPath: plan.changesetPath,
      operations: plan.operations.map(({ content, diff, ...operation }) => operation),
      snapshots,
    };
    await writeJsonAtomic(path.join(historyRoot, "manifest.json"), manifest);
    manifest.phase = "applying";
    await writeJsonAtomic(path.join(historyRoot, "manifest.json"), manifest);

    let executed = 0;
    for (const operation of plan.operations) {
      if (
        process.env.POS_TEST_MODE === "1" &&
        Number(process.env.POS_TEST_INTERFERE_BEFORE_OPERATION ?? 0) === executed + 1
      ) {
        const interferencePath = normalizeRelative(String(process.env.POS_TEST_INTERFERE_PATH ?? ""));
        await assertNoSymlinkComponents(root, interferencePath);
        await atomicWrite(resolveInside(root, interferencePath), String(process.env.POS_TEST_INTERFERE_CONTENT ?? "synthetic concurrent edit\n"));
      }
      await revalidateOperation(root, operation);
      await executeOperation(root, operation);
      for (const relative of [operation.from, operation.path].filter(Boolean)) executedPaths.add(relative);
      executed += 1;
      if (
        process.env.POS_TEST_MODE === "1" &&
        Number(process.env.POS_TEST_FAIL_AFTER_OPERATIONS ?? 0) === executed
      ) {
        throw new PosError("INJECTED_TEST_FAILURE", "Synthetic test failure after a formal operation.", { executed }, 5);
      }
    }
    for (const snapshot of snapshots) snapshot.afterHash = await hashPath(resolveInside(root, snapshot.path));
    await buildIndex(root, { write: true });
    manifest.phase = "committed";
    manifest.appliedAt = isoNow();
    manifest.sealDigest = historySealDigest(manifest);
    await writeJsonAtomic(transactionSealPath, {
      schema: "pos.transaction-seal.v1",
      taskId: plan.taskId,
      digest: manifest.sealDigest,
      createdAt: manifest.appliedAt,
    });
    await writeJsonAtomic(path.join(historyRoot, "manifest.json"), manifest);
    await updateTaskStatus(root, plan.taskId, "applied", { appliedAt: manifest.appliedAt, planDigest: plan.planDigest });
    await appendAudit(root, {
      schema: "pos.audit.v1",
      event: "apply",
      taskId: plan.taskId,
      at: manifest.appliedAt,
      planDigest: plan.planDigest,
      operations: plan.operations.map((operation) => ({ id: operation.id, action: operation.action, from: operation.from, path: operation.path, reason: operation.reason })),
      result: "committed",
    });
    return { applied: true, taskId: plan.taskId, planDigest: plan.planDigest, operations: plan.operations.length };
  } catch (error) {
    if (manifest?.snapshots) {
      const rollbackSnapshots = manifest.snapshots.filter((snapshot) => executedPaths.has(snapshot.path));
      if (rollbackSnapshots.length) await restoreSnapshots(root, historyRoot, rollbackSnapshots);
      if (transactionSealPath && (await exists(transactionSealPath))) await removePath(transactionSealPath);
      await buildIndex(root, { write: true });
      manifest.phase = "rolled_back";
      manifest.error = error instanceof Error ? error.message : String(error);
      await writeJsonAtomic(path.join(historyRoot, "manifest.json"), manifest);
      await updateTaskStatus(root, plan.taskId, "failed", { error: manifest.error });
      await appendAudit(root, {
        schema: "pos.audit.v1",
        event: "apply",
        taskId: plan.taskId,
        at: isoNow(),
        result: "rolled_back",
        error: manifest.error,
      });
    } else {
      if (historyRoot && (await exists(historyRoot))) await removePath(historyRoot);
      await recordRejection(root, "apply", plan?.taskId ?? null, error);
    }
    throw error;
  } finally {
    if (lockPath) await rm(lockPath, { force: true });
  }
}

export async function undoTask(rootInput, taskIdInput, options = {}) {
  const taskId = safeComponent(taskIdInput, "Task ID");
  const { root } = await openRoot(rootInput);
  if (!options.yes) {
    const error = new PosError("APPROVAL_REQUIRED", "Undo requires --yes after reviewing the task history.", undefined, 7);
    await recordRejection(root, "undo", taskId, error);
    throw error;
  }
  let lockPath = null;
  const historyRoot = path.join(root, ".pos", "history", taskId);
  const manifestPath = path.join(historyRoot, "manifest.json");
  const undoRoot = path.join(historyRoot, "undo-before");
  let currentSnapshots = null;
  let manifest = null;
  let originalManifest = null;
  let originalTask = null;
  const taskPath = path.join(root, "99_AI", "runs", taskId, "task.json");
  try {
    lockPath = await acquireLock(root, `undo-${taskId}`);
    await assertNoSymlinkComponents(root, `.pos/history/${taskId}/manifest.json`);
    invariant(await exists(historyRoot), "HISTORY_NOT_FOUND", "No applied history exists for this task.", { taskId }, 4);
    manifest = await readJson(manifestPath);
    invariant(manifest.phase === "committed" && !manifest.undoneAt, "HISTORY_NOT_UNDOABLE", "Task is not in a committed undoable state.", { taskId, phase: manifest.phase }, 4);
    manifest.snapshots = await verifyHistory(root, taskId, historyRoot, manifest);
    originalManifest = structuredClone(manifest);
    await assertNoSymlinkComponents(root, `99_AI/runs/${taskId}/task.json`);
    if (await exists(taskPath)) originalTask = await readJson(taskPath);
    for (const snapshot of manifest.snapshots) {
      await assertNoSymlinkComponents(root, snapshot.path);
      if (snapshot.existed) await assertNoSymlinkComponents(root, `.pos/history/${taskId}/${snapshot.backup}`);
      const current = await hashPath(resolveInside(root, snapshot.path));
      if (!options.force && current !== snapshot.afterHash) {
        throw new PosError("UNDO_CONFLICT", "A later change conflicts with this undo.", { path: snapshot.path, expected: snapshot.afterHash, actual: current }, 4);
      }
    }
    manifest.phase = "undoing";
    await writeJsonAtomic(manifestPath, manifest);
    await ensureDir(undoRoot);
    currentSnapshots = await snapshotAffected(root, undoRoot, manifest.snapshots.map((snapshot) => snapshot.path));
    await restoreSnapshots(root, historyRoot, manifest.snapshots);
    if (process.env.POS_TEST_MODE === "1" && process.env.POS_TEST_FAIL_DURING_UNDO === "1") {
      throw new PosError("INJECTED_UNDO_FAILURE", "Synthetic test failure during undo.", null, 5);
    }
    await buildIndex(root, { write: true });
    manifest.phase = "undone";
    manifest.undoneAt = isoNow();
    await writeJsonAtomic(manifestPath, manifest);
    await updateTaskStatus(root, taskId, "undone", { undoneAt: manifest.undoneAt });
    if (process.env.POS_TEST_MODE === "1" && process.env.POS_TEST_FAIL_AFTER_UNDO_STATUS === "1") {
      throw new PosError("INJECTED_LATE_UNDO_FAILURE", "Synthetic test failure after undo status updates.", null, 5);
    }
    await appendAudit(root, {
      schema: "pos.audit.v1",
      event: "undo",
      taskId,
      at: manifest.undoneAt,
      result: "committed",
    });
    return { undone: true, taskId, restoredPaths: manifest.snapshots.length };
  } catch (error) {
    if (currentSnapshots) {
      await restoreSnapshots(root, undoRoot, currentSnapshots);
      await buildIndex(root, { write: true });
    }
    if (originalManifest) await writeJsonAtomic(manifestPath, originalManifest);
    if (originalTask) {
      await assertNoSymlinkComponents(root, `99_AI/runs/${taskId}/task.json`);
      await writeJsonAtomic(taskPath, originalTask);
    }
    await recordRejection(root, "undo", taskId, error);
    throw error;
  } finally {
    if (lockPath) await rm(lockPath, { force: true });
  }
}
