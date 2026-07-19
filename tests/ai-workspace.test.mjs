import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { applyChangeset, undoTask } from "../scripts/lib/changeset.mjs";
import { diagnose } from "../scripts/lib/doctor.mjs";
import { buildIndex } from "../scripts/lib/indexer.mjs";
import { exists, hashPath, readJson, writeJsonAtomic } from "../scripts/lib/io.mjs";
import { createRun } from "../scripts/lib/runs.mjs";
import { createWorkspaceUpgradePlan, upgradeWorkspace } from "../scripts/lib/workspace-upgrade.mjs";
import { withSandbox, writeFixture } from "./helpers.mjs";

async function convertFixtureToLegacy(root) {
  const markerPath = path.join(root, ".pos", "project.json");
  const marker = await readJson(markerPath);
  delete marker.aiWorkspaceLayout;
  delete marker.aiWorkspaceUpgradedAt;
  await writeJsonAtomic(markerPath, marker);

  const policyPath = path.join(root, ".pos", "policy.json");
  const policy = await readJson(policyPath);
  policy.autoWrite = ["99_AI/runs/**"];
  policy.ignoreIndex = [".git/**", ".pos/**", "99_AI/agents/**", "99_AI/proposed/**", "99_AI/runs/**", "99_AI/trash/**", "node_modules/**"];
  await writeJsonAtomic(policyPath, policy);

  await rm(path.join(root, "99_AI", "hosts"), { recursive: true, force: true });
  await rm(path.join(root, "99_AI", "shared"), { recursive: true, force: true });
  await rm(path.join(root, "99_AI", "CONTEXT.md"), { force: true });

  const run = "99_AI/runs/legacy-run";
  await mkdir(path.join(root, run, "work"), { recursive: true });
  await mkdir(path.join(root, run, "proposed"), { recursive: true });
  await mkdir(path.join(root, "99_AI", "agents", "reviewer"), { recursive: true });
  await mkdir(path.join(root, "99_AI", "proposed"), { recursive: true });
  await writeFile(path.join(root, "99_AI", "agents", "reviewer", "AGENT.md"), "# Legacy reviewer\n");
  await writeFile(path.join(root, "99_AI", "proposed", "canary.md"), "legacy proposal must survive\n");
  await writeFile(path.join(root, run, "work", "canary.md"), "legacy run must survive\n");
  await writeFile(path.join(root, run, "RESULT.md"), "# Result\n");
  await writeJsonAtomic(path.join(root, run, "task.json"), {
    schema: "pos.task.v1",
    id: "legacy-run",
    status: "created",
    goal: "legacy synthetic task",
    writeScope: ["20_Areas/示例领域/Experience/**"],
  });
  await writeFile(path.join(root, run, "proposed", "experience.md"), "# Legacy experience\n");
  await writeJsonAtomic(path.join(root, run, "CHANGESET.json"), {
    schema: "pos.changeset.v1",
    taskId: "legacy-run",
    summary: "promote a legacy experience",
    writeScope: ["20_Areas/示例领域/Experience/**"],
    operations: [{
      id: "legacy-create",
      action: "create",
      path: "20_Areas/示例领域/Experience/legacy.md",
      source: "99_AI/runs/legacy-run/proposed/experience.md",
      reason: "legacy compatibility test",
    }],
  });
  return { run, marker, policy };
}

test("creates isolated host workspaces and keeps Role Profiles outside user data", async () => {
  await withSandbox(async ({ root }) => {
    const codex = await createRun(root, { goal: "same topic", hostId: "codex", roleId: "creator" });
    const claude = await createRun(root, { goal: "same topic", hostId: "claude", roleId: "reviewer" });

    assert.match(codex.run, /^99_AI\/hosts\/codex\/runs\//u);
    assert.match(claude.run, /^99_AI\/hosts\/claude-code\/runs\//u);
    assert.notEqual(codex.run, claude.run);
    assert.equal(codex.task.roleId, "creator");
    assert.equal(claude.task.roleId, "reviewer");
    assert.equal(await exists(path.join(root, "99_AI", "agents")), false);
    assert.equal(await exists(path.join(root, codex.run, "logs")), true);
    assert.equal(await exists(path.join(root, claude.run, "logs")), true);
    assert.equal(codex.context.context.some((item) => item.path === "skill://roles/creator.md"), true);
    assert.equal(claude.context.context.some((item) => item.path === "skill://roles/reviewer.md"), true);

    process.env.PERSONAL_OS_HOST = "qcode";
    const environmentHost = await createRun(root, { goal: "environment host", roleId: "research" });
    delete process.env.PERSONAL_OS_HOST;
    assert.match(environmentHost.run, /^99_AI\/hosts\/qcode\/runs\//u);

    await writeFixture(root, `${codex.run}/work/private-draft.md`, "# Temporary\n");
    const indexed = await buildIndex(root, { rebuild: true });
    assert.equal(indexed.records.some((record) => record.path.startsWith("99_AI/")), false);
  });
});

test("previews legacy workspace migration without mutation and applies it without data loss", async () => {
  await withSandbox(async ({ root }) => {
    await convertFixtureToLegacy(root);
    const before = await hashPath(root);
    const plan = await createWorkspaceUpgradePlan(root);
    assert.equal(plan.direction, "upgrade");
    assert.equal(plan.moves.length, 3);
    const preview = await upgradeWorkspace(root);
    assert.equal(preview.applied, false);
    assert.equal(preview.requiresApproval, true);
    assert.equal(await hashPath(root), before);
    await assert.rejects(() => createRun(root, { goal: "must upgrade first" }), (error) => error.code === "WORKSPACE_UPGRADE_REQUIRED");

    const result = await upgradeWorkspace(root, { yes: true });
    assert.equal(result.applied, true);
    assert.equal(await readFile(path.join(root, "99_AI", "hosts", "legacy", "runs", "legacy-run", "work", "canary.md"), "utf8"), "legacy run must survive\n");
    assert.equal(await readFile(path.join(root, "99_AI", "shared", "legacy-roles", "reviewer", "AGENT.md"), "utf8"), "# Legacy reviewer\n");
    assert.equal(await readFile(path.join(root, "99_AI", "shared", "legacy-proposed", "canary.md"), "utf8"), "legacy proposal must survive\n");
    assert.equal(await exists(path.join(root, "99_AI", "runs")), false);
    assert.equal((await readJson(path.join(root, ".pos", "project.json"))).aiWorkspaceLayout, "pos.ai-workspace.hosts.v1");
    assert.equal((await readJson(path.join(root, ".pos", "policy.json"))).ignoreIndex.includes("99_AI/**"), true);

    const report = await diagnose(root);
    assert.equal(report.issues.some((issue) => issue.severity === "error"), false);
    const nextRun = await createRun(root, { goal: "new host run", hostId: "workbuddy", roleId: "builder" });
    assert.match(nextRun.run, /^99_AI\/hosts\/workbuddy\/runs\//u);
  });
});

test("preserves legacy apply history and undo after host-workspace migration", async () => {
  await withSandbox(async ({ root }) => {
    await convertFixtureToLegacy(root);
    await applyChangeset(root, "99_AI/runs/legacy-run/CHANGESET.json", { yes: true });
    const durable = path.join(root, "20_Areas", "示例领域", "Experience", "legacy.md");
    assert.equal(await exists(durable), true);

    await upgradeWorkspace(root, { yes: true });
    const undone = await undoTask(root, "legacy-run", { yes: true });
    assert.equal(undone.undone, true);
    assert.equal(await exists(durable), false);
    const migratedTask = await readJson(path.join(root, "99_AI", "hosts", "legacy", "runs", "legacy-run", "task.json"));
    assert.equal(migratedTask.status, "undone");
  });
});

test("refuses conflicting partial migration targets without moving legacy data", async () => {
  await withSandbox(async ({ root }) => {
    await convertFixtureToLegacy(root);
    await mkdir(path.join(root, "99_AI", "hosts", "legacy", "runs"), { recursive: true });
    const plan = await createWorkspaceUpgradePlan(root);
    assert.equal(plan.conflicts.some((item) => item.code === "WORKSPACE_UPGRADE_TARGET_EXISTS"), true);
    await assert.rejects(() => upgradeWorkspace(root, { yes: true }), (error) => error.code === "WORKSPACE_UPGRADE_CONFLICT");
    assert.equal(await readFile(path.join(root, "99_AI", "runs", "legacy-run", "work", "canary.md"), "utf8"), "legacy run must survive\n");
  });
});

test("rolls back moved data and control files after an injected workspace-upgrade failure", async () => {
  await withSandbox(async ({ root }) => {
    const { marker, policy } = await convertFixtureToLegacy(root);
    process.env.POS_TEST_FAIL_WORKSPACE_UPGRADE_AFTER_MOVES = "1";
    await assert.rejects(() => upgradeWorkspace(root, { yes: true }), (error) => error.code === "INJECTED_WORKSPACE_UPGRADE_FAILURE");
    delete process.env.POS_TEST_FAIL_WORKSPACE_UPGRADE_AFTER_MOVES;

    assert.equal(await readFile(path.join(root, "99_AI", "runs", "legacy-run", "work", "canary.md"), "utf8"), "legacy run must survive\n");
    assert.equal(await exists(path.join(root, "99_AI", "hosts", "legacy", "runs", "legacy-run")), false);
    assert.deepEqual(await readJson(path.join(root, ".pos", "project.json")), marker);
    assert.deepEqual(await readJson(path.join(root, ".pos", "policy.json")), policy);
  });
});
