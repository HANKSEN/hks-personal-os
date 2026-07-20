import { readdir } from "node:fs/promises";
import path from "node:path";

import { AI_WORKSPACE_LAYOUT, resolveHostId, workspaceLayout } from "./ai-workspace.mjs";
import { buildIndex } from "./indexer.mjs";
import { exists, readJson, readJsonl } from "./io.mjs";
import { LEGACY_ROOT_DIRS, openRoot, ROOT_DIRS } from "./root.mjs";
import { assertNoSymlinkComponents, walkSafe } from "./safe-path.mjs";

export async function diagnose(rootInput) {
  const { root, marker } = await openRoot(rootInput);
  const issues = [];
  const modernWorkspace = workspaceLayout(marker) === AI_WORKSPACE_LAYOUT;
  for (const relative of ["POS.md", ...(modernWorkspace ? ROOT_DIRS : LEGACY_ROOT_DIRS)]) {
    if (!(await exists(path.join(root, relative)))) issues.push({ severity: "error", code: "MISSING_REQUIRED_PATH", path: relative });
  }
  if (!modernWorkspace) issues.push({ severity: "warning", code: "LEGACY_AI_WORKSPACE", message: "Preview and approve `pos workspace-upgrade <root>` before creating new Runs." });

  const current = await buildIndex(root, { write: false, rebuild: true });
  const metaPath = path.join(root, ".pos", "index.meta.json");
  if (await exists(metaPath)) {
    const storedMeta = await readJson(metaPath);
    if (storedMeta.sourceDigest !== current.meta.sourceDigest) {
      issues.push({ severity: "warning", code: "STALE_INDEX", message: "Run pos index to refresh the generated index." });
    }
  } else {
    issues.push({ severity: "warning", code: "MISSING_INDEX_META" });
  }

  const storedRecords = await readJsonl(path.join(root, ".pos", "index.jsonl"));
  const ids = new Map();
  for (const record of current.records) {
    if (!record.id) continue;
    const paths = ids.get(record.id) ?? [];
    paths.push(record.path);
    ids.set(record.id, paths);
  }
  for (const [id, paths] of ids) {
    if (paths.length > 1) issues.push({ severity: "error", code: "DUPLICATE_ID", id, paths });
  }
  const knownIds = new Set(current.records.map((record) => record.id).filter(Boolean));
  for (const record of current.records) {
    for (const related of record.related ?? []) {
      if (typeof related !== "string" || related.includes("://") || related.includes("/")) continue;
      if (!knownIds.has(related)) issues.push({ severity: "warning", code: "BROKEN_RELATED_ID", path: record.path, related });
    }
  }

  const { symlinks } = await walkSafe(root, {
    skip: (relative) => relative === ".git" || relative.startsWith(".git/") || relative === ".pos/history" || relative.startsWith(".pos/history/") || relative === ".pos/transactions" || relative.startsWith(".pos/transactions/"),
  });
  for (const symlink of symlinks) issues.push({ severity: "error", code: "SYMLINK_PRESENT", path: symlink });

  const terminalStatuses = new Set(["completed", "applied", "undone", "failed", "cancelled"]);
  const inspectRuns = async (runsRoot, runsRelative, expectedHost = null) => {
    if (!(await exists(runsRoot))) return;
    const runs = await readdir(runsRoot, { withFileTypes: true });
    for (const run of runs.filter((item) => item.isDirectory())) {
      const taskPath = path.join(runsRoot, run.name, "task.json");
      const resultPath = path.join(runsRoot, run.name, "RESULT.md");
      const runRelative = `${runsRelative}/${run.name}`;
      await assertNoSymlinkComponents(root, `${runRelative}/task.json`);
      await assertNoSymlinkComponents(root, `${runRelative}/RESULT.md`);
      if (!(await exists(taskPath))) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: runRelative, missing: "task.json" });
        continue;
      }
      if (!(await exists(resultPath))) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: runRelative, missing: "RESULT.md" });
        continue;
      }
      const task = await readJson(taskPath);
      const migratedLegacyTask = expectedHost === "legacy" && task.schema === "pos.task.v1";
      if (expectedHost && !migratedLegacyTask && (task.schema !== "pos.task.v2" || task.hostId !== expectedHost || task.run !== runRelative)) {
        issues.push({ severity: "error", code: "RUN_HOST_MISMATCH", run: runRelative, expectedHost, actualHost: task.hostId ?? null });
      }
      if (!terminalStatuses.has(task.status)) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: runRelative, status: task.status ?? "unknown" });
      }
    }
  };

  if (modernWorkspace) {
    const hostsRoot = path.join(root, "99_AI", "hosts");
    if (await exists(hostsRoot)) {
      const hosts = await readdir(hostsRoot, { withFileTypes: true });
      for (const host of hosts.filter((item) => item.isDirectory())) {
        let hostId;
        try {
          hostId = resolveHostId(host.name, {});
        } catch {
          issues.push({ severity: "error", code: "INVALID_HOST_WORKSPACE", path: `99_AI/hosts/${host.name}` });
          continue;
        }
        if (hostId !== host.name) {
          issues.push({ severity: "error", code: "INVALID_HOST_WORKSPACE", path: `99_AI/hosts/${host.name}`, canonicalHost: hostId });
          continue;
        }
        const hostRelative = `99_AI/hosts/${hostId}`;
        if (!(await exists(path.join(root, hostRelative, "CONTEXT.md")))) issues.push({ severity: "warning", code: "HOST_CONTEXT_MISSING", path: `${hostRelative}/CONTEXT.md` });
        await inspectRuns(path.join(root, hostRelative, "runs"), `${hostRelative}/runs`, hostId);
      }
    }
  } else {
    await inspectRuns(path.join(root, "99_AI", "runs"), "99_AI/runs");
  }

  const lockPath = path.join(root, ".pos", "lock");
  if (await exists(lockPath)) issues.push({ severity: "warning", code: "APPLY_LOCK_PRESENT", path: ".pos/lock" });

  const historyRoot = path.join(root, ".pos", "history");
  if (await exists(historyRoot)) {
    const histories = await readdir(historyRoot, { withFileTypes: true });
    for (const history of histories.filter((item) => item.isDirectory())) {
      const manifestPath = path.join(historyRoot, history.name, "manifest.json");
      await assertNoSymlinkComponents(root, `.pos/history/${history.name}/manifest.json`);
      if (!(await exists(manifestPath))) {
        issues.push({ severity: "error", code: "HISTORY_MANIFEST_MISSING", taskId: history.name });
        continue;
      }
      const manifest = await readJson(manifestPath);
      if (["prepared", "applying", "undoing"].includes(manifest.phase)) issues.push({ severity: "error", code: "RECOVERY_REQUIRED", taskId: history.name, phase: manifest.phase });
      if (manifest.phase === "rolled_back") issues.push({ severity: "warning", code: "ROLLED_BACK_TRANSACTION", taskId: history.name });
      if (["committed", "undone"].includes(manifest.phase)) {
        const sealRelative = `.pos/transactions/${history.name}.json`;
        await assertNoSymlinkComponents(root, sealRelative);
        const sealPath = path.join(root, ".pos", "transactions", `${history.name}.json`);
        if (!(await exists(sealPath))) {
          issues.push({ severity: "error", code: "HISTORY_SEAL_MISSING", taskId: history.name });
        } else {
          const seal = await readJson(sealPath);
          if (seal.schema !== "pos.transaction-seal.v1" || (seal.changeId ?? seal.taskId) !== history.name || seal.taskId !== manifest.taskId || seal.digest !== manifest.sealDigest) {
            issues.push({ severity: "error", code: "HISTORY_SEAL_MISMATCH", taskId: manifest.taskId ?? history.name, undoId: history.name });
          }
        }
      }
    }
  }

  const approvalsRoot = path.join(root, ".pos", "approvals");
  if (await exists(approvalsRoot)) {
    const approvals = await readdir(approvalsRoot, { withFileTypes: true });
    for (const approval of approvals.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      const approvalRelative = `.pos/approvals/${approval.name}`;
      await assertNoSymlinkComponents(root, approvalRelative);
      const record = await readJson(path.join(approvalsRoot, approval.name));
      if (record.status !== "applied" || !record.undoId) continue;
      const undoId = String(record.undoId);
      const manifestRelative = `.pos/history/${undoId}/manifest.json`;
      await assertNoSymlinkComponents(root, manifestRelative);
      if (!(await exists(resolvePath(root, manifestRelative)))) {
        issues.push({
          severity: "error",
          code: "APPLIED_APPROVAL_HISTORY_MISSING",
          proposalId: record.proposalId ?? approval.name.replace(/\.json$/u, ""),
          taskId: record.taskId ?? null,
          undoId,
          message: "The approved files may exist, but automatic Undo is unavailable because its history manifest is missing.",
        });
      }
    }
  }

  return {
    schema: "pos.doctor.v1",
    healthy: !issues.some((issue) => issue.severity === "error"),
    summary: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      indexedRecords: storedRecords.length,
    },
    issues,
  };
}

function resolvePath(root, relative) {
  return path.join(root, ...relative.split("/"));
}
