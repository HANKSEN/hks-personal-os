import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { applyChangeset, planChangeset, undoTask } from "../scripts/lib/changeset.mjs";
import { exists, hashPath, readJson, sha256File } from "../scripts/lib/io.mjs";
import { withSandbox, createProposal, writeFixture } from "./helpers.mjs";

test("previews without side effects, applies a create, and undoes it", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Experience/2026-07-虚构文章复盘.md";
    const proposal = await createProposal(root, {
      goal: "保存虚构文章复盘",
      writeScope: ["20_Areas/示例领域/Experience/**"],
      operations: [{ id: "op-create", action: "create", path: destination, sourceContent: "# 虚构文章复盘\n\n结果来自合成数据。\n", reason: "记录一次具体结果" }],
    });
    const beforeTree = await hashPath(path.join(root, "20_Areas"));
    const beforeAudit = await readFile(path.join(root, ".pos", "audit.jsonl"), "utf8");
    const preview = await applyChangeset(root, proposal.changesetPath);
    assert.equal(preview.applied, false);
    assert.match(preview.preview.operations[0].diff, /\+# 虚构文章复盘/u);
    assert.equal(await hashPath(path.join(root, "20_Areas")), beforeTree);
    assert.equal(await readFile(path.join(root, ".pos", "audit.jsonl"), "utf8"), beforeAudit);

    const applied = await applyChangeset(root, proposal.changesetPath, { yes: true });
    assert.equal(applied.applied, true);
    assert.equal(await exists(path.join(root, destination)), true);
    const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
    assert.equal(manifest.phase, "committed");

    await assert.rejects(() => undoTask(root, proposal.taskId), (error) => error.code === "APPROVAL_REQUIRED");
    const refusalAudit = await readFile(path.join(root, ".pos", "audit.jsonl"), "utf8");
    assert.match(refusalAudit, /"event":"undo"[\s\S]*"code":"APPROVAL_REQUIRED"/u);
    const undone = await undoTask(root, proposal.taskId, { yes: true });
    assert.equal(undone.undone, true);
    assert.equal(await exists(path.join(root, destination)), false);
  });
});

test("updates with an expected hash and restores the original content", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Principles/内容SOP.md";
    const absolute = await writeFixture(root, destination, "# 内容 SOP\n\n原始步骤。\n");
    const expectedHash = await sha256File(absolute);
    const proposal = await createProposal(root, {
      goal: "更新虚构内容 SOP",
      writeScope: ["20_Areas/示例领域/Principles/**"],
      operations: [{ id: "op-update", action: "update", path: destination, expectedHash, sourceContent: "# 内容 SOP\n\n原始步骤。\n\n新增验证。\n", reason: "补充验证步骤" }],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    assert.match(await readFile(absolute, "utf8"), /新增验证/u);
    await undoTask(root, proposal.taskId, { yes: true });
    assert.equal(await readFile(absolute, "utf8"), "# 内容 SOP\n\n原始步骤。\n");
  });
});

test("rolls back every formal path after an injected mid-transaction failure", async () => {
  await withSandbox(async ({ root }) => {
    const first = "20_Areas/示例领域/Experience/first.md";
    const second = "20_Areas/示例领域/Experience/second.md";
    const proposal = await createProposal(root, {
      goal: "模拟事务失败",
      writeScope: ["20_Areas/示例领域/Experience/**"],
      operations: [
        { id: "first", action: "create", path: first, sourceContent: "# First\n", reason: "synthetic" },
        { id: "second", action: "create", path: second, sourceContent: "# Second\n", reason: "synthetic" },
      ],
    });
    process.env.POS_TEST_FAIL_AFTER_OPERATIONS = "1";
    await assert.rejects(() => applyChangeset(root, proposal.changesetPath, { yes: true }), (error) => error.code === "INJECTED_TEST_FAILURE");
    assert.equal(await exists(path.join(root, first)), false);
    assert.equal(await exists(path.join(root, second)), false);
    const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
    assert.equal(manifest.phase, "rolled_back");
  });
});

test("archives and undoes a synthetic project without hard deletion", async () => {
  await withSandbox(async ({ root }) => {
    const source = "10_Projects/虚构项目";
    await writeFixture(root, `${source}/CONTEXT.md`, "# 虚构项目\n");
    const proposal = await createProposal(root, {
      goal: "归档虚构项目",
      writeScope: ["10_Projects/**", "90_Archive/**"],
      operations: [{ id: "archive", action: "archive", from: source, reason: "项目已完成" }],
    });
    const plan = await planChangeset(root, proposal.changesetPath);
    const archivePath = plan.operations[0].path;
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    assert.equal(await exists(path.join(root, source)), false);
    assert.equal(await exists(path.join(root, archivePath)), true);
    await undoTask(root, proposal.taskId, { yes: true });
    assert.equal(await exists(path.join(root, source)), true);
    assert.equal(await exists(path.join(root, archivePath)), false);
  });
});

test("supports reversible move and trash semantics without permanent deletion", async () => {
  await withSandbox(async ({ root }) => {
    await writeFixture(root, "10_Projects/虚构移动/source.md", "# Source\n");
    const move = await createProposal(root, {
      goal: "移动虚构工作文件",
      writeScope: ["10_Projects/**"],
      operations: [{ id: "move", action: "move", from: "10_Projects/虚构移动/source.md", path: "10_Projects/虚构移动/Output/final.md", reason: "promote output" }],
    });
    await applyChangeset(root, move.changesetPath, { yes: true });
    assert.equal(await exists(path.join(root, "10_Projects/虚构移动/Output/final.md")), true);
    await undoTask(root, move.taskId, { yes: true });
    assert.equal(await exists(path.join(root, "10_Projects/虚构移动/source.md")), true);

    const trash = await createProposal(root, {
      goal: "把虚构文件移入受控回收区",
      writeScope: ["10_Projects/**", "99_AI/trash/**"],
      operations: [{ id: "trash", action: "trash", from: "10_Projects/虚构移动/source.md", reason: "user requested removal without hard delete" }],
    });
    const plan = await planChangeset(root, trash.changesetPath);
    await applyChangeset(root, trash.changesetPath, { yes: true });
    assert.equal(await exists(path.join(root, plan.operations[0].path)), true);
    await undoTask(root, trash.taskId, { yes: true });
    assert.equal(await exists(path.join(root, "10_Projects/虚构移动/source.md")), true);
  });
});

test("undo failure injection restores the complete applied state before returning", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Experience/undo-atomic.md";
    const proposal = await createProposal(root, {
      goal: "验证撤销原子性",
      writeScope: ["20_Areas/示例领域/Experience/**"],
      operations: [{ id: "create", action: "create", path: destination, sourceContent: "# Undo atomicity\n", reason: "synthetic" }],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    process.env.POS_TEST_FAIL_DURING_UNDO = "1";
    await assert.rejects(() => undoTask(root, proposal.taskId, { yes: true }), (error) => error.code === "INJECTED_UNDO_FAILURE");
    assert.equal(await exists(path.join(root, destination)), true);
    const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
    assert.equal(manifest.phase, "committed");
    delete process.env.POS_TEST_FAIL_DURING_UNDO;
    await undoTask(root, proposal.taskId, { yes: true });
    assert.equal(await exists(path.join(root, destination)), false);
  });
});

test("rejects stale updates, audits the refusal, and never overwrites later content", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Knowledge/stale.md";
    const absolute = await writeFixture(root, destination, "# Original\n");
    const proposal = await createProposal(root, {
      goal: "验证过期内容保护",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "stale", action: "update", path: destination, expectedHash: await sha256File(absolute), sourceContent: "# Proposed\n", reason: "synthetic" }],
    });
    await writeFile(absolute, "# Later user edit\n");
    await assert.rejects(() => applyChangeset(root, proposal.changesetPath, { yes: true }), (error) => error.code === "STALE_CONTENT");
    assert.equal(await readFile(absolute, "utf8"), "# Later user edit\n");
    const audit = await readFile(path.join(root, ".pos", "audit.jsonl"), "utf8");
    assert.match(audit, /"result":"rejected"/u);
  });
});

test("revalidates immediately before each operation and preserves a concurrent edit", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Knowledge/concurrent.md";
    const absolute = await writeFixture(root, destination, "# Before\n");
    const proposal = await createProposal(root, {
      goal: "验证执行前逐操作复核",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "update", action: "update", path: destination, expectedHash: await sha256File(absolute), sourceContent: "# Proposed\n", reason: "synthetic" }],
    });
    process.env.POS_TEST_INTERFERE_BEFORE_OPERATION = "1";
    process.env.POS_TEST_INTERFERE_PATH = destination;
    process.env.POS_TEST_INTERFERE_CONTENT = "# Concurrent editor change\n";
    await assert.rejects(() => applyChangeset(root, proposal.changesetPath, { yes: true }), (error) => error.code === "STALE_CONTENT");
    assert.equal(await readFile(absolute, "utf8"), "# Concurrent editor change\n");
    const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
    assert.equal(manifest.phase, "rolled_back");
  });
});

test("refuses undo when a later edit conflicts with the applied after-state", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Knowledge/conflict.md";
    const absolute = await writeFixture(root, destination, "# Before\n");
    const proposal = await createProposal(root, {
      goal: "验证撤销冲突",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "update", action: "update", path: destination, expectedHash: await sha256File(absolute), sourceContent: "# Applied\n", reason: "synthetic" }],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    const task = await readJson(path.join(root, "99_AI", "runs", proposal.taskId, "task.json"));
    assert.equal(task.status, "applied");
    await writeFile(absolute, "# Later edit\n");
    await assert.rejects(() => undoTask(root, proposal.taskId, { yes: true }), (error) => error.code === "UNDO_CONFLICT");
    assert.equal(await readFile(absolute, "utf8"), "# Later edit\n");
  });
});

test("rejects exact duplicate targets instead of allowing the later operation to overwrite", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Knowledge/duplicate-target.md";
    const proposal = await createProposal(root, {
      goal: "验证重复目标冲突",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [
        { id: "first", action: "create", path: destination, sourceContent: "# First\n", reason: "synthetic" },
        { id: "second", action: "create", path: destination, sourceContent: "# Second\n", reason: "synthetic" },
      ],
    });
    await assert.rejects(() => planChangeset(root, proposal.changesetPath), (error) => error.code === "OVERLAPPING_OPERATIONS");
    assert.equal(await exists(path.join(root, destination)), false);

    const aliases = await createProposal(root, {
      goal: "验证大小写与 Unicode 等价目标",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [
        { id: "upper", action: "create", path: "20_Areas/示例领域/Knowledge/Alias.md", sourceContent: "# First\n", reason: "synthetic" },
        { id: "lower", action: "create", path: "20_Areas/示例领域/Knowledge/alias.md", sourceContent: "# Second\n", reason: "synthetic" },
      ],
    });
    await assert.rejects(() => planChangeset(root, aliases.changesetPath), (error) => error.code === "OVERLAPPING_OPERATIONS");

    const unicodeAliases = await createProposal(root, {
      goal: "验证 Unicode 等价目标",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [
        { id: "composed", action: "create", path: "20_Areas/示例领域/Knowledge/é.md", sourceContent: "# First\n", reason: "synthetic" },
        { id: "decomposed", action: "create", path: "20_Areas/示例领域/Knowledge/é.md", sourceContent: "# Second\n", reason: "synthetic" },
      ],
    });
    await assert.rejects(() => planChangeset(root, unicodeAliases.changesetPath), (error) => error.code === "OVERLAPPING_OPERATIONS");
  });
});

test("requires CONTEXT.md when a Changeset creates a new Project", async () => {
  await withSandbox(async ({ root }) => {
    const invalid = await createProposal(root, {
      goal: "创建缺少上下文的项目",
      writeScope: ["10_Projects/新项目/**"],
      operations: [
        { id: "working", action: "create", path: "10_Projects/新项目/Working/note.md", sourceContent: "# Note\n", reason: "synthetic" },
      ],
    });
    await assert.rejects(() => planChangeset(root, invalid.changesetPath), (error) => error.code === "CONTEXT_REQUIRED_FOR_NEW_CONTAINER");

    const valid = await createProposal(root, {
      goal: "创建带上下文的新项目",
      writeScope: ["10_Projects/新项目/**"],
      operations: [
        { id: "context", action: "create", path: "10_Projects/新项目/CONTEXT.md", sourceContent: "# 新项目\n", reason: "define project" },
        { id: "working", action: "create", path: "10_Projects/新项目/Working/note.md", sourceContent: "# Note\n", reason: "synthetic" },
      ],
    });
    await applyChangeset(root, valid.changesetPath, { yes: true, approveProtected: true });
    assert.equal(await exists(path.join(root, "10_Projects/新项目/CONTEXT.md")), true);
    assert.equal(await exists(path.join(root, "10_Projects/新项目/Working/note.md")), true);
  });
});

test("restores files, manifest, and Task status after a late undo failure", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Experience/late-undo.md";
    const proposal = await createProposal(root, {
      goal: "验证撤销晚期失败恢复",
      writeScope: ["20_Areas/示例领域/Experience/**"],
      operations: [{ id: "create", action: "create", path: destination, sourceContent: "# Applied\n", reason: "synthetic" }],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    process.env.POS_TEST_FAIL_AFTER_UNDO_STATUS = "1";
    await assert.rejects(() => undoTask(root, proposal.taskId, { yes: true }), (error) => error.code === "INJECTED_LATE_UNDO_FAILURE");
    assert.equal(await exists(path.join(root, destination)), true);
    const manifest = await readJson(path.join(root, ".pos", "history", proposal.taskId, "manifest.json"));
    const task = await readJson(path.join(root, "99_AI", "runs", proposal.taskId, "task.json"));
    assert.equal(manifest.phase, "committed");
    assert.equal(task.status, "applied");
  });
});

test("audits empty apply refusals without mutating formal files", async () => {
  await withSandbox(async ({ root }) => {
    const run = await import("../scripts/lib/runs.mjs").then(({ createRun }) => createRun(root, { goal: "空变更" }));
    await assert.rejects(() => applyChangeset(root, `${run.run}/CHANGESET.json`, { yes: true }), (error) => error.code === "EMPTY_CHANGESET");
    const audit = await readFile(path.join(root, ".pos", "audit.jsonl"), "utf8");
    assert.match(audit, /"code":"EMPTY_CHANGESET"/u);
  });
});
