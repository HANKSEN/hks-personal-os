import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { applyChangeset, planChangeset, undoTask } from "../scripts/lib/changeset.mjs";
import { exists, readJson, sha256File } from "../scripts/lib/io.mjs";
import { createProposal, withSandbox, writeFixture } from "./helpers.mjs";

async function recoveryCase(root, action, { includeGuard = false } = {}) {
  const experienceScope = "20_Areas/示例领域/Experience/**";
  let operation;
  let writeScope;
  let original;

  if (action === "create") {
    operation = { id: action, action, path: "20_Areas/示例领域/Knowledge/recovery-create.md", sourceContent: "# Created\n", reason: "synthetic" };
    writeScope = ["20_Areas/示例领域/Knowledge/**"];
    original = { source: null, destination: operation.path, before: null, after: "# Created\n" };
  } else if (action === "update") {
    const target = "20_Areas/示例领域/Knowledge/recovery-update.md";
    const absolute = await writeFixture(root, target, "# Before\n");
    operation = { id: action, action, path: target, expectedHash: await sha256File(absolute), sourceContent: "# Updated\n", reason: "synthetic" };
    writeScope = ["20_Areas/示例领域/Knowledge/**"];
    original = { source: target, destination: target, before: "# Before\n", after: "# Updated\n" };
  } else if (action === "move") {
    const source = "10_Projects/recovery-move/source.md";
    const destination = "10_Projects/recovery-move/Output/final.md";
    await writeFixture(root, source, "# Move\n");
    operation = { id: action, action, from: source, path: destination, reason: "synthetic" };
    writeScope = ["10_Projects/**"];
    original = { source, destination, before: "# Move\n", after: "# Move\n" };
  } else if (action === "archive") {
    const source = "10_Projects/recovery-archive";
    await writeFixture(root, `${source}/CONTEXT.md`, "# Archive\n");
    operation = { id: action, action, from: source, reason: "synthetic" };
    writeScope = ["10_Projects/**", "90_Archive/**"];
    original = { source, destination: null, before: "directory", after: "directory" };
  } else {
    const source = "10_Projects/recovery-trash/source.md";
    await writeFixture(root, source, "# Trash\n");
    operation = { id: action, action, from: source, reason: "synthetic" };
    writeScope = ["10_Projects/**", "99_AI/trash/**"];
    original = { source, destination: null, before: "# Trash\n", after: "# Trash\n" };
  }

  const operations = [operation];
  if (includeGuard) {
    writeScope.push(experienceScope);
    operations.push({
      id: `guard-${action}`,
      action: "create",
      path: `20_Areas/示例领域/Experience/recovery-guard-${action}.md`,
      sourceContent: "# Guard\n",
      reason: "force a second transaction step",
    });
  }
  const proposal = await createProposal(root, { goal: `恢复矩阵 ${action}`, writeScope, operations });
  const plan = await planChangeset(root, proposal.changesetPath);
  original.destination = plan.operations[0].path;
  return { proposal, plan, original };
}

test("mid-apply rollback restores every supported operation type", async () => {
  for (const action of ["create", "update", "move", "archive", "trash"]) {
    await withSandbox(async ({ root }) => {
      const { proposal, original } = await recoveryCase(root, action, { includeGuard: true });
      process.env.POS_TEST_FAIL_AFTER_OPERATIONS = "1";
      await assert.rejects(() => applyChangeset(root, proposal.changesetPath, { yes: true }), (error) => error.code === "INJECTED_TEST_FAILURE");

      if (action === "create") {
        assert.equal(await exists(path.join(root, original.destination)), false);
      } else if (action === "update") {
        assert.equal(await readFile(path.join(root, original.source), "utf8"), original.before);
      } else {
        assert.equal(await exists(path.join(root, original.source)), true);
        assert.equal(await exists(path.join(root, original.destination)), false);
      }
      const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
      assert.equal(manifest.phase, "rolled_back");
    });
  }
});

test("mid-undo rollback preserves the applied state for every supported operation type", async () => {
  for (const action of ["create", "update", "move", "archive", "trash"]) {
    await withSandbox(async ({ root }) => {
      const { proposal, original } = await recoveryCase(root, action);
      await applyChangeset(root, proposal.changesetPath, { yes: true });
      process.env.POS_TEST_FAIL_DURING_UNDO = "1";
      await assert.rejects(() => undoTask(root, proposal.taskId, { yes: true }), (error) => error.code === "INJECTED_UNDO_FAILURE");

      if (action === "create") {
        assert.equal(await exists(path.join(root, original.destination)), true);
      } else if (action === "update") {
        assert.equal(await readFile(path.join(root, original.destination), "utf8"), original.after);
      } else {
        assert.equal(await exists(path.join(root, original.source)), false);
        assert.equal(await exists(path.join(root, original.destination)), true);
      }
      const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
      assert.equal(manifest.phase, "committed");
    });
  }
});
