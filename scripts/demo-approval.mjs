#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { approvalStatus, createApprovalProposal, decideApproval } from "./lib/approval.mjs";
import { errorPayload } from "./lib/errors.mjs";
import { writeJsonAtomic } from "./lib/io.mjs";
import { initializeRoot } from "./lib/root.mjs";
import { createRun } from "./lib/runs.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(sourceRoot, "demo", "approval-panel.html"), "utf8");
const runId = randomUUID();
const base = await mkdtemp(path.join(os.tmpdir(), "personal-os-test-approval-demo-"));
const root = path.join(base, "Personal_OS");
await mkdir(root);
await writeFile(path.join(root, ".pos-test-fixture"), `${runId}\n`);
process.env.POS_TEST_MODE = "1";
process.env.POS_TEST_RUN_ID = runId;
await initializeRoot(root, { areas: ["公开创作"], mode: "collaborative" });

const run = await createRun(root, {
  goal: "沉淀一条经过验证的创作经验",
  hostId: "codex",
  roleId: "reviewer",
  area: "公开创作",
  writeScope: ["20_Areas/公开创作/Experience/**"],
});
const source = `${run.run}/proposed/op-001.md`;
const absoluteSource = path.join(root, source);
await mkdir(path.dirname(absoluteSource), { recursive: true });
await writeFile(absoluteSource, "# 文章封面 A/B 测试复盘\n\n结果：信息密度更低的封面点击率提升 18%。\n");
const changesetPath = `${run.run}/CHANGESET.json`;
await writeJsonAtomic(path.join(root, changesetPath), {
  schema: "pos.changeset.v1",
  taskId: run.taskId,
  summary: "将已验证的封面实验结果存为 Experience",
  writeScope: ["20_Areas/公开创作/Experience/**"],
  operations: [{
    id: "op-001",
    action: "create",
    path: "20_Areas/公开创作/Experience/2026-07-文章封面AB测试.md",
    source,
    reason: "记录真实行动、数据结果和可复用的复盘证据",
  }],
});
const proposal = await createApprovalProposal(root, changesetPath);

function label(status) {
  return ({ awaiting_approval: "等待人工确认", applied: "已批准并写入", revision_requested: "已要求修改", declined: "已拒绝", cancelled: "已暂停", stale: "提案已失效" })[status] ?? status;
}
function risk(item) {
  if (item.requiresProtectedApproval) return "high";
  return item.operations.some((operation) => ["move", "archive", "trash", "update"].includes(operation.action)) ? "medium" : "low";
}
async function payload() {
  const current = await approvalStatus(root, proposal.proposalId);
  return { proposal: current, risk: risk(current), statusLabel: label(current.status), demoRoot: root };
}
async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(html); return;
    }
    if (request.method === "GET" && request.url === "/api/proposal") { json(response, 200, await payload()); return; }
    if (request.method === "POST" && request.url === "/api/decision") {
      const input = await body(request);
      await decideApproval(root, proposal.proposalId, input.decision, { channel: "local-demo" });
      const next = await payload();
      json(response, 200, { ...next, message: label(next.proposal.status) }); return;
    }
    json(response, 404, { error: { message: "Not found" } });
  } catch (error) { json(response, 400, errorPayload(error)); }
});
const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] ?? 0);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`Hks Personal OS V1.3.1 approval demo\nURL: http://127.0.0.1:${address.port}\nDisposable root: ${root}\n`);
});
async function cleanup() {
  server.close();
  const marker = (await readFile(path.join(root, ".pos-test-fixture"), "utf8")).trim();
  if (marker === runId && path.basename(base).startsWith("personal-os-test-approval-demo-") && path.resolve(base).startsWith(path.resolve(os.tmpdir()))) await rm(base, { recursive: true, force: true });
}
process.on("SIGINT", () => cleanup().finally(() => process.exit(0)));
process.on("SIGTERM", () => cleanup().finally(() => process.exit(0)));
