import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { approvalStatus, createApprovalProposal, decideApproval } from "../scripts/lib/approval.mjs";
import { undoTask } from "../scripts/lib/changeset.mjs";
import { diagnose } from "../scripts/lib/doctor.mjs";
import { hashPath, sha256File, writeJsonAtomic } from "../scripts/lib/io.mjs";
import { createProposal, withSandbox, writeFixture } from "./helpers.mjs";

test("approval binds the reviewed digest and applies exactly once", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Create one approved knowledge note",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/approved.md", sourceContent: "# Approved\n", reason: "Keep verified knowledge" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    assert.equal(proposal.status, "awaiting_approval");
    assert.equal(proposal.operationCount, 1);
    assert.match(proposal.confirmationPhrase, new RegExp(`^APPROVE ${proposal.proposalId}$`, "u"));

    const result = await decideApproval(root, proposal.proposalId, "approve", { channel: "test" });
    assert.equal(result.applied, true);
    assert.equal(result.proposal.status, "applied");
    assert.equal(result.proposal.undoId, candidate.taskId);
    assert.equal(await readFile(path.join(root, "20_Areas", "示例领域", "Knowledge", "approved.md"), "utf8"), "# Approved\n");
    await assert.rejects(
      () => decideApproval(root, proposal.proposalId, "approve", { channel: "test" }),
      (error) => error.code === "APPROVAL_ALREADY_DECIDED",
    );
    await undoTask(root, candidate.taskId, { yes: true });
  });
});

test("approval lazily adds its control directory to a pre-1.2 root", async () => {
  await withSandbox(async ({ root }) => {
    await rm(path.join(root, ".pos", "approvals"), { recursive: true });
    const candidate = await createProposal(root, {
      goal: "Create proposal on a legacy-compatible root",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/legacy-root.md", sourceContent: "# Legacy-compatible\n", reason: "Compatibility test" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    assert.equal(proposal.status, "awaiting_approval");
    assert.equal((await approvalStatus(root, proposal.proposalId)).proposalId, proposal.proposalId);
  });
});

test("approval rejects a changeset changed after preview", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Create immutable proposal",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/immutable.md", sourceContent: "# Before\n", reason: "Original proposal" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    candidate.changeset.operations[0].reason = "Changed after approval preview";
    await writeFixture(root, candidate.changesetPath, `${JSON.stringify(candidate.changeset, null, 2)}\n`);

    await assert.rejects(
      () => decideApproval(root, proposal.proposalId, "approve", { channel: "test" }),
      (error) => error.code === "APPROVED_PLAN_CHANGED",
    );
    assert.equal((await approvalStatus(root, proposal.proposalId)).status, "stale");
    assert.equal(await hashPath(path.join(root, "20_Areas", "示例领域", "Knowledge", "immutable.md")), null);
  });
});

test("reject revise and cancel never write formal assets", async () => {
  for (const [decision, expectedStatus] of [["reject", "declined"], ["revise", "revision_requested"], ["cancel", "cancelled"]]) {
    await withSandbox(async ({ root }) => {
      const candidate = await createProposal(root, {
        goal: `Decision ${decision}`,
        writeScope: ["20_Areas/示例领域/Knowledge/**"],
        operations: [{ id: "op-001", action: "create", path: `20_Areas/示例领域/Knowledge/${decision}.md`, sourceContent: "# Candidate\n", reason: "Decision test" }],
      });
      const proposal = await createApprovalProposal(root, candidate.changesetPath);
      const result = await decideApproval(root, proposal.proposalId, decision, { channel: "test", note: "synthetic decision" });
      assert.equal(result.applied, false);
      assert.equal(result.proposal.status, expectedStatus);
      assert.equal(await hashPath(path.join(root, "20_Areas", "示例领域", "Knowledge", `${decision}.md`)), null);
    });
  }
});

test("protected Context changes require a separate approval", async () => {
  await withSandbox(async ({ root }) => {
    const expectedHash = await sha256File(path.join(root, "POS.md"));
    const candidate = await createProposal(root, {
      goal: "Update protected context",
      writeScope: ["POS.md"],
      operations: [{ id: "op-001", action: "update", path: "POS.md", expectedHash, sourceContent: "# Updated protected context\n", reason: "Explicit context update" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    assert.equal(proposal.requiresProtectedApproval, true);
    await assert.rejects(
      () => decideApproval(root, proposal.proposalId, "approve", { channel: "test" }),
      (error) => error.code === "PROTECTED_APPROVAL_REQUIRED",
    );
    assert.equal((await approvalStatus(root, proposal.proposalId)).status, "awaiting_approval");
    const result = await decideApproval(root, proposal.proposalId, "approve", { channel: "test", approveProtected: true });
    assert.equal(result.applied, true);
  });
});

test("doctor reports an applied approval whose undo history is missing", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Detect missing approval history",
      changeId: "diagnostic-batch",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "op-001", action: "create", path: "20_Areas/示例领域/Knowledge/diagnostic.md", sourceContent: "# Diagnostic\n", reason: "diagnostic test" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    await decideApproval(root, proposal.proposalId, "approve", { channel: "test" });
    await rm(path.join(root, ".pos/history/diagnostic-batch"), { recursive: true });
    const result = await diagnose(root);
    assert.equal(result.healthy, false);
    assert.ok(result.issues.some((issue) => issue.code === "APPLIED_APPROVAL_HISTORY_MISSING" && issue.undoId === "diagnostic-batch"));
  });
});

test("approval proposal stays compact for a large single-line source", async () => {
  await withSandbox(async ({ root }) => {
    const candidate = await createProposal(root, {
      goal: "Bound approval payload",
      writeScope: ["30_Resources/**"],
      operations: [{ id: "large-line", action: "create", path: "30_Resources/bounded.jsonl", sourceContent: "x".repeat(1024 * 1024), reason: "bounded approval" }],
    });
    const proposal = await createApprovalProposal(root, candidate.changesetPath);
    assert.ok(JSON.stringify(proposal).length < 10_000);
  });
});

test("two approval panels can apply distinct batches from the same Task", async () => {
  await withSandbox(async ({ root }) => {
    const first = await createProposal(root, {
      goal: "Approve two batches",
      changeId: "panel-batch-1",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "one", action: "create", path: "20_Areas/示例领域/Knowledge/panel-one.md", sourceContent: "# One\n", reason: "one" }],
    });
    const firstProposal = await createApprovalProposal(root, first.changesetPath);
    const firstResult = await decideApproval(root, firstProposal.proposalId, "approve", { channel: "test" });
    assert.equal(firstResult.proposal.undoId, "panel-batch-1");

    const source = `${first.run}/proposed/panel-two.md`;
    await writeFixture(root, source, "# Two\n");
    const secondPath = `${first.run}/CHANGESET_PANEL_2.json`;
    await writeJsonAtomic(path.join(root, secondPath), {
      schema: "pos.changeset.v1",
      taskId: first.taskId,
      changeId: "panel-batch-2",
      summary: "Second panel",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "two", action: "create", path: "20_Areas/示例领域/Knowledge/panel-two.md", source, reason: "two" }],
    });
    const secondProposal = await createApprovalProposal(root, secondPath);
    const secondResult = await decideApproval(root, secondProposal.proposalId, "approve", { channel: "test" });
    assert.equal(secondResult.proposal.undoId, "panel-batch-2");
    assert.notEqual(firstResult.proposal.undoId, secondResult.proposal.undoId);
  });
});
