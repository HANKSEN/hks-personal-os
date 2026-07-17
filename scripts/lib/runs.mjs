import { randomUUID } from "node:crypto";
import path from "node:path";

import { retrieveContext } from "./context.mjs";
import { atomicWrite, ensureDir, exists, isoNow, writeJsonAtomic } from "./io.mjs";
import { openRoot } from "./root.mjs";
import { assertNoSymlinkComponents, resolveInside, safeComponent } from "./safe-path.mjs";

function slug(value) {
  const cleaned = String(value ?? "task")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 36);
  return cleaned || "task";
}

export async function createRun(rootInput, options = {}) {
  const { root } = await openRoot(rootInput);
  const goal = String(options.goal ?? "").trim();
  const agentId = safeComponent(String(options.agentId ?? "orchestrator"), "Agent ID");
  const area = options.area ? safeComponent(String(options.area), "Area") : null;
  const project = options.project ? safeComponent(String(options.project), "Project") : null;
  const agentManifestRelative = `99_AI/agents/${agentId}/AGENT.md`;
  await assertNoSymlinkComponents(root, agentManifestRelative);
  const agentManifest = resolveInside(root, agentManifestRelative);
  if (!(await exists(agentManifest))) {
    throw new Error(`Agent manifest not found: ${agentId}`);
  }
  const taskId = `${new Date().toISOString().replace(/[-:.]/gu, "").slice(0, 15)}-${slug(goal)}-${randomUUID().slice(0, 8)}`;
  safeComponent(taskId, "Task ID");
  const runRelative = `99_AI/runs/${taskId}`;
  const runRoot = resolveInside(root, runRelative);
  await ensureDir(path.join(runRoot, "work"));
  await ensureDir(path.join(runRoot, "proposed"));

  const context = await retrieveContext(root, {
    query: options.query ?? goal,
    area,
    project,
    maxFiles: options.maxFiles,
    maxChars: options.maxChars,
    agentId,
  });
  const defaultWriteScope = [
    `${runRelative}/**`,
    ...(project ? [`10_Projects/${project}/**`] : []),
    ...(area ? [`20_Areas/${area}/**`] : []),
  ];
  const writeScope = options.writeScope?.length ? options.writeScope : defaultWriteScope;
  const createdAt = isoNow();
  const task = {
    schema: "pos.task.v1",
    id: taskId,
    status: options.status ?? "created",
    request: String(options.request ?? goal),
    goal,
    intent: options.intent ?? null,
    agentId,
    agentVersion: "1.0.0",
    deliverable: options.deliverable ?? null,
    area,
    project,
    persistence: options.persistence ?? "draft",
    risk: options.risk ?? "low",
    writeScope,
    assumptions: options.assumptions ?? [],
    missingInformation: options.missingInformation ?? [],
    approvalRequired: options.approvalRequired ?? false,
    createdAt,
  };

  const taskMarkdown = `---\nschema: pos.task.v1\nid: ${JSON.stringify(taskId)}\nstatus: ${task.status}\nintent: ${task.intent ?? ""}\nagent_id: ${agentId}\nagent_version: 1.0.0\narea: ${task.area ? JSON.stringify(task.area) : ""}\nproject: ${task.project ? JSON.stringify(task.project) : ""}\nrisk: ${task.risk}\ncreated_at: ${createdAt}\n---\n\n# Task\n\n## Request\n\n${task.request}\n\n## Goal\n\n${task.goal}\n\n## Deliverable\n\n${task.deliverable ?? ""}\n\n## Assumptions\n\n${task.assumptions.map((item) => `- ${item}`).join("\n")}\n\n## Missing information\n\n${task.missingInformation.map((item) => `- ${item}`).join("\n")}\n\n## Context refs\n\n${context.context.map((item) => `- ${item.path} — ${item.reason}`).join("\n")}\n\n## Write scope\n\n${writeScope.map((item) => `- ${item}`).join("\n")}\n\n## Approval required\n\n${task.approvalRequired ? "yes" : "no"}\n`;

  await atomicWrite(path.join(runRoot, "TASK.md"), taskMarkdown);
  await writeJsonAtomic(path.join(runRoot, "task.json"), task);
  await writeJsonAtomic(path.join(runRoot, "context.json"), context);
  await writeJsonAtomic(path.join(runRoot, "CHANGESET.json"), {
    schema: "pos.changeset.v1",
    taskId,
    summary: "",
    writeScope,
    operations: [],
  });
  await atomicWrite(path.join(runRoot, "RESULT.md"), `---\nschema: pos.result.v1\ntask_id: ${JSON.stringify(taskId)}\nstatus: pending\nundo_id:\n---\n\n# Result\n\n## Outcome\n\n## Context used\n\n## Files proposed or changed\n\n## Decisions and assumptions\n\n## Unresolved\n\n## Next action\n`);
  return { taskId, run: runRelative, task, context };
}
