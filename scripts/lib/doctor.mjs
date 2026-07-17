import { readdir } from "node:fs/promises";
import path from "node:path";

import { buildIndex } from "./indexer.mjs";
import { exists, readJson, readJsonl } from "./io.mjs";
import { openRoot, ROOT_DIRS } from "./root.mjs";
import { assertNoSymlinkComponents, walkSafe } from "./safe-path.mjs";

export async function diagnose(rootInput) {
  const { root } = await openRoot(rootInput);
  const issues = [];
  for (const relative of ["POS.md", ...ROOT_DIRS]) {
    if (!(await exists(path.join(root, relative)))) issues.push({ severity: "error", code: "MISSING_REQUIRED_PATH", path: relative });
  }

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

  const runsRoot = path.join(root, "99_AI", "runs");
  if (await exists(runsRoot)) {
    const runs = await readdir(runsRoot, { withFileTypes: true });
    const terminalStatuses = new Set(["completed", "applied", "undone", "failed", "cancelled"]);
    for (const run of runs.filter((item) => item.isDirectory())) {
      const taskPath = path.join(runsRoot, run.name, "task.json");
      const resultPath = path.join(runsRoot, run.name, "RESULT.md");
      await assertNoSymlinkComponents(root, `99_AI/runs/${run.name}/task.json`);
      await assertNoSymlinkComponents(root, `99_AI/runs/${run.name}/RESULT.md`);
      if (!(await exists(taskPath))) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: run.name, missing: "task.json" });
        continue;
      }
      if (!(await exists(resultPath))) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: run.name, missing: "RESULT.md" });
        continue;
      }
      const task = await readJson(taskPath);
      if (!terminalStatuses.has(task.status)) {
        issues.push({ severity: "warning", code: "INCOMPLETE_RUN", run: run.name, status: task.status ?? "unknown" });
      }
    }
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
          if (seal.schema !== "pos.transaction-seal.v1" || seal.taskId !== history.name || seal.digest !== manifest.sealDigest) {
            issues.push({ severity: "error", code: "HISTORY_SEAL_MISMATCH", taskId: history.name });
          }
        }
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
