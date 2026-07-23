import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createApprovalProposal, decideApproval } from "../scripts/lib/approval.mjs";
import { renderApprovalVisual, writeApprovalVisual } from "../scripts/lib/approval-visual.mjs";
import { createProposal, withSandbox } from "./helpers.mjs";

async function pendingProposal(root, goal = "可视化审批测试") {
  const candidate = await createProposal(root, {
    goal,
    writeScope: ["20_Areas/示例领域/Artifacts/**"],
    operations: [{
      id: "op-001",
      action: "create",
      path: "20_Areas/示例领域/Artifacts/approval-visual.md",
      sourceContent: "# approval visual\n",
      reason: "验证结构化审批卡",
    }],
  });
  return createApprovalProposal(root, candidate.changesetPath);
}

test("approval visual renders structured operations and sends a bound follow-up decision", async () => {
  await withSandbox(async ({ root, base }) => {
    const proposal = await pendingProposal(root);
    const outputPath = path.join(base, "approval-card.html");
    const result = await writeApprovalVisual(root, proposal.proposalId, outputPath);
    const html = await readFile(outputPath, "utf8");

    assert.equal(result.schema, "pos.approval-visual.v1");
    assert.match(html, /Personal OS 变更审批/u);
    assert.match(html, /文件变更/u);
    assert.match(html, /允许写入范围/u);
    assert.match(html, /确认并继续/u);
    assert.match(html, /要求修改/u);
    assert.match(html, /拒绝/u);
    assert.match(html, /暂不处理/u);
    assert.match(html, new RegExp(proposal.proposalId, "u"));
    assert.match(html, new RegExp(proposal.planDigest, "u"));
    assert.match(html, /window\.openai\.sendFollowUpMessage/u);
    assert.match(html, /请先读取审批状态并核对/u);
    const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(script, "approval visual must include its interaction script");
    assert.doesNotThrow(() => new Function(script), "generated approval visual JavaScript must parse");
    assert.match(script, /\.join\("\\n"\)/u);
    assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|WebSocket/u);
    assert.ok(html.indexOf("文件变更") < html.indexOf("允许写入范围"));
    assert.ok(html.indexOf("允许写入范围") < html.indexOf("操作决定"));
  });
});

test("approval visual escapes proposal content and refuses overwrite", async () => {
  await withSandbox(async ({ root, base }) => {
    const proposal = await pendingProposal(root, "<script>alert('x')</script>");
    const html = renderApprovalVisual(proposal, { root });
    assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/u);
    assert.match(html, /&lt;script&gt;alert/u);

    const outputPath = path.join(base, "approval-card.html");
    await writeApprovalVisual(root, proposal.proposalId, outputPath);
    await assert.rejects(() => writeApprovalVisual(root, proposal.proposalId, outputPath), (error) => error?.code === "OUTPUT_EXISTS");
  });
});

test("approval visual cannot render an already decided proposal", async () => {
  await withSandbox(async ({ root, base }) => {
    const proposal = await pendingProposal(root);
    await decideApproval(root, proposal.proposalId, "cancel", { channel: "test" });
    await assert.rejects(
      () => writeApprovalVisual(root, proposal.proposalId, path.join(base, "decided.html")),
      (error) => error?.code === "APPROVAL_ALREADY_DECIDED",
    );
  });
});
