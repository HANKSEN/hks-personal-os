import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runLocationFromRelative } from "./ai-workspace.mjs";
import { PosError, invariant } from "./errors.mjs";
import { atomicWrite, exists, readJson, readTextBounded, sha256File, writeJsonAtomic } from "./io.mjs";
import { markdownInfo } from "./markdown.mjs";
import { openRoot } from "./root.mjs";
import { createRun } from "./runs.mjs";
import { assertRootNotSymlink, pathIdentity, resolveInside, walkSafe } from "./safe-path.mjs";
import { BACKUP_WARNING } from "./setup.mjs";

const DEFAULT_TEXT_BYTES = 64 * 1024;
const DEFAULT_HASH_BYTES = 32 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".zsh", ".xml"]);
const RESOURCE_EXTENSIONS = new Set([".pdf", ".epub", ".mobi", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const SENSITIVE_NAME = /(?:^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$)|[^/]+\.(?:pem|key|p12|pfx|kdbx))|(?:token|api[-_]?key|private[-_]?key)/iu;
const CONTROL_DIRECTORIES = new Set([".git", ".pos", "node_modules", ".svn", ".hg"]);

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function auditTestBoundary(source) {
  if (process.env.POS_TEST_MODE !== "1") return;
  const resolved = path.resolve(source);
  const temp = path.resolve(os.tmpdir());
  const relative = path.relative(temp, resolved);
  invariant(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "TEST_AUDIT_SOURCE_OUTSIDE_TEMP", "Synthetic audit sources must remain under the operating-system temporary directory.", { source: resolved }, 3);
  invariant(relative.split(path.sep).some((part) => part.startsWith("personal-os-test-")), "TEST_AUDIT_SOURCE_INVALID_PREFIX", "Synthetic audit sources must use the personal-os-test- prefix.", { source: resolved }, 3);
}

function isControlPath(relative, entry) {
  const parts = relative.split("/");
  if (parts.some((part) => CONTROL_DIRECTORIES.has(part))) return true;
  return entry?.isDirectory() && parts.some((part) => part === "__pycache__");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function suggestedClassification(relative, extension) {
  const normalized = relative.normalize("NFKC");
  const lower = normalized.toLowerCase();
  const base = path.basename(normalized);
  const safeRelative = normalized.split("/").filter(Boolean).join("/");
  if (/(?:^|\/)(?:archive|archived|old|legacy|completed|done|归档|已完成)(?:\/|$)/iu.test(lower)) {
    return { owner: "90_Archive", assetType: "archive", lifecycle: "inactive", target: `90_Archive/Imported/${safeRelative}`, confidence: 0.75, reason: "Path indicates inactive or completed material." };
  }
  if (/(?:^|\/)(?:projects?|active|working|项目|进行中)(?:\/|$)/iu.test(lower)) {
    return { owner: "10_Projects/Imported", assetType: "working", lifecycle: "active", target: `10_Projects/Imported/${safeRelative}`, confidence: 0.62, reason: "Path suggests work with an active lifecycle; its outcome and done condition still require review." };
  }
  if (RESOURCE_EXTENSIONS.has(extension) || /(?:^|\/)(?:resources?|references?|sources?|资料|参考)(?:\/|$)/iu.test(lower)) {
    return { owner: "30_Resources", assetType: "source", lifecycle: "reference", target: `30_Resources/Imported/${safeRelative}`, confidence: 0.7, reason: "File appears to be external reference material." };
  }
  if (/(?:sop|playbook|principle|method|方法|原则|流程|规范)/iu.test(base)) {
    return { owner: "20_Areas/Imported", assetType: "Principles", lifecycle: "durable", target: `20_Areas/Imported/Principles/${base}`, confidence: 0.6, reason: "Filename suggests a reusable method or operating rule; Area ownership still requires review." };
  }
  if (/(?:review|retrospective|decision|复盘|决策|经验|实验)/iu.test(base)) {
    return { owner: "20_Areas/Imported", assetType: "Experience", lifecycle: "durable", target: `20_Areas/Imported/Experience/${base}`, confidence: 0.6, reason: "Filename suggests a time-bound action, decision, result, or review; Area ownership still requires review." };
  }
  if (/(?:published|release|final|article|video|skill|deliverable|已发布|终稿|文章|视频|交付)/iu.test(base)) {
    return { owner: "20_Areas/Imported", assetType: "Artifacts", lifecycle: "durable", target: `20_Areas/Imported/Artifacts/${base}`, confidence: 0.58, reason: "Filename suggests a completed or publishable output; Area ownership still requires review." };
  }
  if ([".csv", ".tsv", ".xlsx", ".xls"].includes(extension) || /(?:metrics?|analytics?|data|数据|指标)/iu.test(base)) {
    return { owner: "20_Areas/Imported", assetType: "Data", lifecycle: "durable", target: `20_Areas/Imported/Data/${base}`, confidence: 0.58, reason: "File appears to contain structured facts or measurements; Area ownership still requires review." };
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return { owner: "00_Inbox", assetType: "untriaged", lifecycle: "untriaged", target: `00_Inbox/Imported/${safeRelative}`, confidence: 0.35, reason: "Text content needs user or Agent context before durable classification." };
  }
  return { owner: "00_Inbox", assetType: "untriaged", lifecycle: "untriaged", target: `00_Inbox/Imported/${safeRelative}`, confidence: 0.25, reason: "No reliable ownership signal was found." };
}

function annotateFindings(records) {
  const duplicateGroups = [];
  const byHash = new Map();
  for (const record of records) {
    if (!record.sha256) continue;
    const group = byHash.get(record.sha256) ?? [];
    group.push(record);
    byHash.set(record.sha256, group);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const id = `duplicate-${String(duplicateGroups.length + 1).padStart(3, "0")}`;
    for (const record of group) {
      record.duplicateGroup = id;
      record.flags.push("duplicate-content");
    }
    duplicateGroups.push({ id, sha256: group[0].sha256, paths: group.map((record) => record.sourcePath) });
  }

  const targetCollisionGroups = [];
  const byTarget = new Map();
  for (const record of records) {
    const identity = pathIdentity(record.proposedTarget);
    const group = byTarget.get(identity) ?? [];
    group.push(record);
    byTarget.set(identity, group);
  }
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    const id = `target-collision-${String(targetCollisionGroups.length + 1).padStart(3, "0")}`;
    for (const record of group) {
      record.targetCollisionGroup = id;
      record.flags.push("proposed-target-collision");
    }
    targetCollisionGroups.push({ id, proposedTargets: [...new Set(group.map((record) => record.proposedTarget))], paths: group.map((record) => record.sourcePath) });
  }
  return { duplicateGroups, targetCollisionGroups };
}

function sourceDigest(records, symlinks) {
  const hash = createHash("sha256");
  for (const record of records) hash.update(`${record.sourcePath}\0${record.kind}\0${record.size}\0${record.modifiedAt}\0${record.sha256 ?? ""}\0`);
  for (const symlink of symlinks) hash.update(`symlink\0${symlink}\0`);
  return hash.digest("hex");
}

async function scanSource(source, { maxTextBytes = DEFAULT_TEXT_BYTES, maxHashBytes = DEFAULT_HASH_BYTES, includeExcerpt = true } = {}) {
  const { files, symlinks } = await walkSafe(source, { skip: isControlPath });
  const records = [];
  for (const file of files) {
    const relative = file.relative.split(path.sep).join("/");
    const extension = path.extname(relative).toLowerCase();
    const sensitive = SENSITIVE_NAME.test(relative);
    const tooLargeToHash = file.info.size > maxHashBytes;
    const flags = [];
    if (sensitive) flags.push("sensitive-name");
    if (tooLargeToHash) flags.push("large-file");
    let excerpt = null;
    let title = null;
    let truncated = false;
    if (!sensitive && includeExcerpt && TEXT_EXTENSIONS.has(extension)) {
      const bounded = await readTextBounded(file.absolute, maxTextBytes);
      truncated = bounded.truncated;
      if (truncated) flags.push("truncated-text");
      if (extension === ".md" || extension === ".mdx") {
        const info = markdownInfo(bounded.text, relative);
        title = info.title;
        excerpt = info.excerpt;
      } else {
        excerpt = bounded.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").trim().slice(0, 600);
      }
    }
    const classification = suggestedClassification(relative, extension);
    records.push({
      schema: "personal-os.audit-item.v1",
      sourcePath: relative,
      kind: "file",
      size: file.info.size,
      modifiedAt: file.info.mtime.toISOString(),
      sha256: sensitive || tooLargeToHash ? null : await sha256File(file.absolute),
      contentClass: TEXT_EXTENSIONS.has(extension) ? "text" : RESOURCE_EXTENSIONS.has(extension) ? "document" : "binary",
      title,
      excerpt,
      truncated,
      flags,
      observed: { extension, sensitive, symlink: false },
      proposedOwner: classification.owner,
      proposedAssetType: classification.assetType,
      proposedLifecycle: classification.lifecycle,
      proposedTarget: classification.target,
      confidence: classification.confidence,
      reason: classification.reason,
      decision: sensitive ? "excluded-sensitive" : "needs-review",
    });
  }
  records.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en"));
  symlinks.sort((left, right) => left.localeCompare(right, "en"));
  const findings = annotateFindings(records);
  return { records, symlinks, findings, digest: sourceDigest(records, symlinks) };
}

function currentStateReport(source, scan) {
  const counts = new Map();
  for (const record of scan.records) counts.set(record.contentClass, (counts.get(record.contentClass) ?? 0) + 1);
  const sensitive = scan.records.filter((record) => record.flags.includes("sensitive-name"));
  const large = scan.records.filter((record) => record.flags.includes("large-file"));
  const lifecycles = new Map();
  for (const record of scan.records) lifecycles.set(record.proposedLifecycle, (lifecycles.get(record.proposedLifecycle) ?? 0) + 1);
  return `# Current State Report\n\n## Scope\n\n- Source root: ${source}\n- Access: read-only\n- Files inventoried: ${scan.records.length}\n- Symlinks skipped: ${scan.symlinks.length}\n- Source digest: ${scan.digest}\n\n## File classes\n\n${[...counts].map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- None"}\n\n## Proposed lifecycle (unconfirmed)\n\n${[...lifecycles].map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- None"}\n\n## Duplicate and conflict findings\n\n- Exact-content duplicate groups: ${scan.findings.duplicateGroups.length}\n- Proposed target collision groups: ${scan.findings.targetCollisionGroups.length}\n\n## Safety findings\n\n- Sensitive-name files excluded from content reading and migration by default: ${sensitive.length}\n- Files above the hash limit: ${large.length}\n- Symbolic links not followed: ${scan.symlinks.length}\n\n## Interpretation boundary\n\nPaths, sizes, timestamps and hashes are observed filesystem facts. Ownership, lifecycle and asset type are AI-assisted proposals and remain unconfirmed until reviewed by the user.\n`;
}

function migrationPlanMarkdown(plan) {
  const byOwner = new Map();
  for (const item of plan.items) byOwner.set(item.proposedOwner, (byOwner.get(item.proposedOwner) ?? 0) + 1);
  return `# Migration Plan\n\n## Strategy\n\nThe source directory remains read-only. Approved items are copied into the target Personal OS through an isolated Run and reviewed Changeset. No source file is renamed, moved, or deleted.\n\n## Candidate ownership\n\n${[...byOwner].map(([owner, count]) => `- ${owner}: ${count}`).join("\n") || "- None"}\n\n## Review rules\n\n1. Confirm one canonical owner for each durable asset.\n2. Keep ambiguous items unresolved or route them to Inbox.\n3. Do not promote one observation directly to a stable Principle.\n4. Resolve path, ID, case and Unicode collisions before staging.\n5. Sensitive-name files remain excluded unless separately reviewed outside the default workflow.\n`;
}

function pathMappingCsv(items) {
  const header = ["source_path", "source_sha256", "proposed_owner", "asset_type", "lifecycle", "proposed_target", "duplicate_group", "target_collision_group", "confidence", "reason", "decision"];
  const rows = items.map((item) => [item.sourcePath, item.sha256, item.proposedOwner, item.proposedAssetType, item.proposedLifecycle, item.proposedTarget, item.duplicateGroup, item.targetCollisionGroup, item.confidence, item.reason, item.decision]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function unresolvedMarkdown(items, symlinks) {
  const unresolved = items.filter((item) => item.decision !== "approved");
  return `# Unresolved Items\n\nThese items are not authorized for formal migration. Review them by purpose and current owner; do not classify only by filename.\n\n${unresolved.map((item) => `- \`${item.sourcePath}\` — ${item.decision}; candidate: \`${item.proposedTarget}\`; ${item.reason}`).join("\n") || "- None"}\n\n## Symlinks skipped\n\n${symlinks.map((item) => `- \`${item}\``).join("\n") || "- None"}\n`;
}

function archivingGuide() {
  return `# Archiving Guide\n\n## Daily routing\n\n- Unknown intent or untriaged input starts in \`00_Inbox/\`.\n- Work with a finish condition belongs to \`10_Projects/\`.\n- Long-term responsibilities own durable assets in \`20_Areas/\`.\n- Classified external material without an active owner belongs to \`30_Resources/\`.\n- Inactive work moves to \`90_Archive/\` through a reviewed change.\n\n## Area assets\n\n- Knowledge: understood and reusable models.\n- Experience: time-bound actions, decisions, results, and reviews.\n- Principles: evidence-backed methods, rules, and SOPs.\n- Artifacts: completed, shipped, or publishable outputs.\n- Data: structured facts and measurements.\n\nWhen classification is uncertain, state the real goal first and let the Personal OS Skill propose a destination.\n`;
}

async function completeAuditRun(root, run, result) {
  const taskPath = resolveInside(root, `${run.run}/task.json`);
  const task = await readJson(taskPath);
  task.status = "completed";
  task.completedAt = new Date().toISOString();
  await writeJsonAtomic(taskPath, task);
  await atomicWrite(resolveInside(root, `${run.run}/RESULT.md`), `---\nschema: pos.result.v1\ntask_id: ${JSON.stringify(run.taskId)}\nstatus: completed\nundo_id:\n---\n\n# Result\n\n## Outcome\n\nRead-only audit completed. The source directory was not modified by Personal OS.\n\n## Context used\n\n- Source root: ${result.sourceRoot}\n- Source digest before: ${result.sourceDigestBefore}\n- Source digest after: ${result.sourceDigestAfter}\n\n## Files proposed or changed\n\n- Formal Personal OS assets changed: none\n- Audit reports written inside this Run's work directory\n\n## Decisions and assumptions\n\n- All semantic destinations remain proposals until user review.\n\n## Unresolved\n\n- ${result.unresolvedCount} items require review or remain excluded.\n\n## Next action\n\nReview PATH_MAPPING.csv and migration-plan.json. Approve only the items that should be staged for copy migration.\n`);
}

export async function auditExistingDirectory(targetRootInput, sourceRootInput, options = {}) {
  invariant(options.yesRead === true, "AUDIT_READ_APPROVAL_REQUIRED", "Read-only audit requires explicit approval.", { warning: BACKUP_WARNING }, 3);
  const { root: targetRoot } = await openRoot(targetRootInput);
  let sourceRoot = path.resolve(sourceRootInput ?? "");
  invariant(sourceRootInput && await exists(sourceRoot), "AUDIT_SOURCE_NOT_FOUND", "Audit source directory does not exist.", { sourceRoot }, 3);
  auditTestBoundary(sourceRoot);
  await assertRootNotSymlink(sourceRoot);
  sourceRoot = await realpath(sourceRoot);
  invariant(!inside(sourceRoot, targetRoot) && !inside(targetRoot, sourceRoot), "AUDIT_ROOTS_OVERLAP", "Audit source and target Personal OS must be separate non-overlapping directories.", { sourceRoot, targetRoot }, 3);

  const sourceInfo = await lstat(sourceRoot);
  invariant(sourceInfo.isDirectory(), "INVALID_AUDIT_SOURCE", "Audit source must be a directory.", { sourceRoot }, 3);
  const run = await createRun(targetRoot, {
    goal: "Read-only audit of an existing directory",
    request: `Audit source root ${sourceRoot} without modifying it`,
    intent: "maintain",
    deliverable: "existing-directory-audit",
    persistence: "draft",
    risk: "medium",
    hostId: options.hostId,
    roleId: "orchestrator",
    approvalRequired: false,
  });

  const before = await scanSource(sourceRoot, options);
  const plan = {
    schema: "personal-os.migration-plan.v1",
    taskId: run.taskId,
    sourceRoot,
    targetRoot,
    sourceDigest: before.digest,
    createdAt: new Date().toISOString(),
    strategy: "copy-to-new-personal-os",
    items: before.records,
    symlinksSkipped: before.symlinks,
    findings: before.findings,
  };
  const workRoot = resolveInside(targetRoot, `${run.run}/work`);
  await atomicWrite(path.join(workRoot, "audit.jsonl"), `${before.records.map((record) => JSON.stringify(record)).join("\n")}${before.records.length ? "\n" : ""}`);
  await writeJsonAtomic(path.join(workRoot, "migration-plan.json"), plan);
  await atomicWrite(path.join(workRoot, "CURRENT_STATE_REPORT.md"), currentStateReport(sourceRoot, before));
  await atomicWrite(path.join(workRoot, "MIGRATION_PLAN.md"), migrationPlanMarkdown(plan));
  await atomicWrite(path.join(workRoot, "PATH_MAPPING.csv"), pathMappingCsv(plan.items));
  await atomicWrite(path.join(workRoot, "UNRESOLVED.md"), unresolvedMarkdown(plan.items, before.symlinks));
  await atomicWrite(path.join(workRoot, "ARCHIVING_GUIDE.md"), archivingGuide());
  await atomicWrite(path.join(workRoot, "MIGRATION_RESULT.md"), "# Migration Result\n\nStatus: not started\n\nThe source directory has only been audited. No item has been copied into formal Personal OS assets.\n");

  const after = await scanSource(sourceRoot, { ...options, includeExcerpt: false });
  invariant(before.digest === after.digest, "SOURCE_CHANGED_DURING_AUDIT", "The source directory changed during audit. The report is stale and must be regenerated.", { before: before.digest, after: after.digest }, 4);
  const result = {
    schema: "personal-os.audit-result.v1",
    taskId: run.taskId,
    run: run.run,
    sourceRoot,
    targetRoot,
    sourceDigestBefore: before.digest,
    sourceDigestAfter: after.digest,
    files: before.records.length,
    symlinksSkipped: before.symlinks,
    unresolvedCount: before.records.filter((item) => item.decision !== "approved").length,
    findings: before.findings,
    reports: ["CURRENT_STATE_REPORT.md", "MIGRATION_PLAN.md", "PATH_MAPPING.csv", "UNRESOLVED.md", "ARCHIVING_GUIDE.md", "MIGRATION_RESULT.md"].map((name) => `${run.run}/work/${name}`),
    plan: `${run.run}/work/migration-plan.json`,
  };
  await completeAuditRun(targetRoot, run, result);
  return result;
}

export async function readMigrationPlan(targetRootInput, planInput) {
  const { root } = await openRoot(targetRootInput);
  const absolute = path.isAbsolute(planInput) ? path.resolve(planInput) : resolveInside(root, planInput);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  const runLocation = runLocationFromRelative(relative);
  invariant(relative === `${runLocation.runRelative}/work/migration-plan.json`, "MIGRATION_PLAN_LOCATION_REJECTED", "Migration plan must be inside an AI Run work directory.", { plan: relative }, 3);
  const plan = await readJson(absolute);
  invariant(plan?.schema === "personal-os.migration-plan.v1" && Array.isArray(plan.items), "INVALID_MIGRATION_PLAN", "Unsupported migration plan schema.", { schema: plan?.schema }, 2);
  invariant(path.resolve(plan.targetRoot) === root, "MIGRATION_TARGET_MISMATCH", "Migration plan target does not match the current Personal OS root.", { planTarget: plan.targetRoot, root }, 3);
  return { root, relative, absolute, plan, runLocation };
}

export { pathMappingCsv, scanSource };
