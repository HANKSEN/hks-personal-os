import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import test from "node:test";

import { approvalStatus } from "../scripts/lib/approval.mjs";
import { hashPath } from "../scripts/lib/io.mjs";
import { createProposal, withSandbox } from "./helpers.mjs";

function startClient() {
  const child = spawn(process.execPath, [path.resolve("scripts/mcp-server.mjs")], {
    cwd: path.resolve("."),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const waiters = [];
  const messages = [];
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].predicate(message)) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = (predicate, timeout = 5000) => {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP response timed out")), timeout);
      waiters.push({ predicate, resolve, reject, timer });
    });
  };
  return {
    child,
    send,
    waitFor,
    async stop() {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
      lines.close();
    },
  };
}

test("MCP review elicits an interactive decision and applies the bound proposal", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Interactive MCP approval",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/mcp-approved.md", sourceContent: "# MCP approved\n", reason: "Interactive test" }],
    });
    const client = startClient();
    try {
      client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {} } }, clientInfo: { name: "test", version: "1" } } });
      assert.equal((await client.waitFor((item) => item.id === 1)).result.serverInfo.name, "hks-personal-os");
      client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "personal_os_preview", arguments: { root, changeset: candidate.changesetPath } } });
      const preview = await client.waitFor((item) => item.id === 2);
      const proposalId = preview.result.structuredContent.proposal.proposalId;

      client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_os_review", arguments: { root, proposalId } } });
      const elicitation = await client.waitFor((item) => item.method === "elicitation/create");
      assert.match(elicitation.params.message, /Interactive MCP approval/u);
      assert.doesNotMatch(elicitation.params.message, /[\r\n]/u);
      assert.ok(elicitation.params.message.includes("\u2028"), "approval message must use mandatory Unicode line separators");
      const visualLines = elicitation.params.message.split("\u2028");
      for (const expectedLine of [
        "Hks Personal OS · 变更审批",
        "【本次计划】",
        "动作：新建 1 项",
        "【文件变更】",
        "【变更 01】新建",
        "目标：20_Areas/示例领域/Knowledge/mcp-approved.md",
        "【允许写入范围】",
        "【审批边界】",
      ]) assert.ok(visualLines.includes(expectedLine), `missing visual approval line: ${expectedLine}`);
      assert.doesNotMatch(elicitation.params.message, /#{1,6}\s|\*\*(?:新建|更新|移动|归档)|`|\|---\|/u);
      assert.equal(elicitation.params.requestedSchema.properties.decision.title, "审批 1 项文件变更（低风险）");
      client.send({ jsonrpc: "2.0", id: elicitation.id, result: { action: "accept", content: { decision: "approve", note: "approved in synthetic panel" } } });
      const reviewed = await client.waitFor((item) => item.id === 3);
      assert.equal(reviewed.result.structuredContent.applied, true);
      assert.notEqual(await hashPath(path.join(root, "20_Areas", "示例领域", "Knowledge", "mcp-approved.md")), null);
    } finally {
      await client.stop();
    }
  });
});

test("MCP review fails closed with a text fallback when elicitation is unavailable", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Fallback approval",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/fallback.md", sourceContent: "# Fallback\n", reason: "Fallback test" }],
    });
    const client = startClient();
    try {
      client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      await client.waitFor((item) => item.id === 1);
      client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "personal_os_preview", arguments: { root, changeset: candidate.changesetPath } } });
      const preview = await client.waitFor((item) => item.id === 2);
      const proposalId = preview.result.structuredContent.proposal.proposalId;
      client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_os_review", arguments: { root, proposalId } } });
      const reviewed = await client.waitFor((item) => item.id === 3);
      assert.equal(reviewed.result.structuredContent.interactive, false);
      assert.match(reviewed.result.structuredContent.next, new RegExp(`APPROVE ${proposalId}`, "u"));
      assert.equal(await hashPath(path.join(root, "20_Areas", "示例领域", "Knowledge", "fallback.md")), null);
    } finally {
      await client.stop();
    }
  });
});

test("Codex receives an inline-visual handoff instead of an unreadable native form", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Codex inline approval handoff",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/codex-handoff.md", sourceContent: "# Codex handoff\n", reason: "Native form layout is not reviewable" }],
    });
    const client = startClient();
    try {
      client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {} } }, clientInfo: { name: "Codex Desktop", version: "1" } } });
      await client.waitFor((item) => item.id === 1);
      client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "personal_os_preview", arguments: { root, changeset: candidate.changesetPath } } });
      const preview = await client.waitFor((item) => item.id === 2);
      assert.equal(preview.result.structuredContent.interactive, false);
      assert.equal(preview.result.structuredContent.preferredInteraction, "codex-inline-visual");
      const proposalId = preview.result.structuredContent.proposal.proposalId;

      client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_os_review", arguments: { root, proposalId } } });
      const reviewed = await client.waitFor((item) => item.id === 3);
      assert.equal(reviewed.result.structuredContent.schema, "pos.interaction-handoff.v1");
      assert.equal(reviewed.result.structuredContent.reason, "codex-native-form-does-not-preserve-structured-layout");
      assert.equal(reviewed.result.structuredContent.preferredInteraction, "codex-inline-visual");
      assert.equal(reviewed.result.structuredContent.approvalVisual.proposalId, proposalId);
      assert.equal((await approvalStatus(root, proposalId)).status, "awaiting_approval");
      assert.equal(await hashPath(path.join(root, "20_Areas", "示例领域", "Knowledge", "codex-handoff.md")), null);
    } finally {
      await client.stop();
    }
  });
});

test("MCP elicitation timeout remains retryable and does not decide the proposal", async () => {
  await withSandbox(async ({ root }) => {
    process.env.POS_TEST_ELICITATION_TIMEOUT_MS = "30";
    const candidate = await createProposal(root, {
      goal: "Timeout approval",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/timeout.md", sourceContent: "# Timeout\n", reason: "Timeout test" }],
    });
    const client = startClient();
    try {
      client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {} } }, clientInfo: { name: "test", version: "1" } } });
      await client.waitFor((item) => item.id === 1);
      client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "personal_os_preview", arguments: { root, changeset: candidate.changesetPath } } });
      const preview = await client.waitFor((item) => item.id === 2);
      const proposalId = preview.result.structuredContent.proposal.proposalId;
      client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_os_review", arguments: { root, proposalId } } });
      await client.waitFor((item) => item.method === "elicitation/create");
      const pending = await client.waitFor((item) => item.id === 3);
      assert.equal(pending.result.structuredContent.timedOut, true);
      assert.equal(pending.result.structuredContent.status, "awaiting_approval");
      assert.equal(await hashPath(path.join(root, "20_Areas/示例领域/Knowledge/timeout.md")), null);
    } finally {
      await client.stop();
    }
  });
});
