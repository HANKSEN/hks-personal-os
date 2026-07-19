import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runSetup } from "../scripts/install.mjs";
import { exists, hashPath } from "../scripts/lib/io.mjs";
import { initializeRoot } from "../scripts/lib/root.mjs";
import { inspectWorkspacePath } from "../scripts/lib/setup.mjs";

const execFileAsync = promisify(execFile);

async function withSetupSandbox(callback) {
  const base = await mkdtemp(path.join(os.tmpdir(), "personal-os-setup-test-"));
  const home = path.join(base, "home");
  const dataDir = path.join(base, "data", "personal-os");
  const binDir = path.join(base, "bin");
  const outside = path.join(base, "outside");
  await mkdir(home, { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "canary.txt"), "unchanged\n");
  const before = await hashPath(outside);
  try {
    return await callback({ base, home, dataDir, binDir, outside });
  } finally {
    delete process.env.POS_TEST_FAIL_SETUP_AFTER_STAGE;
    assert.equal(await hashPath(outside), before);
    assert.ok(path.basename(base).startsWith("personal-os-setup-test-"));
    await rm(base, { recursive: true, force: true });
  }
}

test("workspace inspection distinguishes missing, empty, initialized, non-empty, and symlink roots", async () => {
  await withSetupSandbox(async ({ base, outside }) => {
    const missing = path.join(base, "missing");
    assert.equal((await inspectWorkspacePath(missing)).state, "missing");
    const empty = path.join(base, "empty");
    await mkdir(empty);
    assert.equal((await inspectWorkspacePath(empty)).state, "empty");
    const nonEmpty = path.join(base, "legacy");
    await mkdir(nonEmpty);
    await writeFile(path.join(nonEmpty, "note.md"), "# note\n");
    assert.equal((await inspectWorkspacePath(nonEmpty)).state, "non-empty");
    const initialized = path.join(base, "initialized");
    await mkdir(initialized);
    await initializeRoot(initialized);
    assert.equal((await inspectWorkspacePath(initialized)).state, "initialized");
    const linked = path.join(base, "linked");
    await symlink(outside, linked);
    assert.equal((await inspectWorkspacePath(linked)).state, "symlink");
  });
});

test("setup installs Skill-first, asks for a workspace mode, and does not create a global CLI", async () => {
  await withSetupSandbox(async ({ home, dataDir, binDir }) => {
    const result = await runSetup({ home, dataDir, binDir, agent: "generic", yes: true });
    assert.equal(result.schema, "personal-os.setup.v1");
    assert.equal(result.state, "WAIT_WORKSPACE_MODE");
    assert.equal(result.installation.globalCliInstalled, false);
    assert.equal(await exists(path.join(home, ".agents", "skills", "personal-os", "SKILL.md")), true);
    assert.equal(await exists(path.join(binDir, "pos")), false);
  });
});

test("new-root setup requires separate initialization authorization and creates a healthy onboarding root", async () => {
  await withSetupSandbox(async ({ base, home, dataDir, binDir }) => {
    const root = path.join(base, "new-personal-os");
    const pending = await runSetup({ home, dataDir, binDir, agent: "generic", yes: true, workspaceMode: "new", root });
    assert.equal(pending.state, "WAIT_ROOT_CONFIRMATION");
    assert.equal(pending.pendingAuthorization.operation, "initialize-new-root");
    assert.equal(await exists(root), false);

    const completed = await runSetup({ home, dataDir, binDir, agent: "generic", yes: true, workspaceMode: "new", root, initialize: true, areas: "学习,创作" });
    assert.equal(completed.state, "FIRST_REAL_TASK");
    assert.equal(completed.health.healthy, true);
    assert.equal(await exists(path.join(root, "START_HERE.md")), true);
    assert.match(await readFile(path.join(root, "START_HERE.md"), "utf8"), /把这份内容当成一个新输入/u);
    assert.equal(await exists(path.join(root, "20_Areas", "学习", "Knowledge")), true);
    assert.equal(completed.onboarding.naturalLanguageStarts.length, 3);
  });
});

test("non-empty new-root candidates route to the existing-directory journey", async () => {
  await withSetupSandbox(async ({ base, home, dataDir, binDir }) => {
    const root = path.join(base, "legacy");
    await mkdir(root);
    await writeFile(path.join(root, "old.md"), "# old\n");
    const result = await runSetup({ home, dataDir, binDir, agent: "generic", yes: true, workspaceMode: "new", root });
    assert.equal(result.state, "WAIT_EXISTING_SOURCE_CONFIRMATION");
    assert.equal(result.journey, "existing");
    assert.equal(await readFile(path.join(root, "old.md"), "utf8"), "# old\n");
  });
});

test("existing-directory setup initializes a separate target and stops at read-only audit approval", async () => {
  await withSetupSandbox(async ({ base, home, dataDir, binDir }) => {
    const source = path.join(base, "legacy");
    const target = path.join(base, "organized");
    await mkdir(source);
    await writeFile(path.join(source, "old.md"), "# old\n");
    const result = await runSetup({
      home,
      dataDir,
      binDir,
      agent: "generic",
      yes: true,
      workspaceMode: "existing",
      source,
      target,
      initialize: true,
    });
    assert.equal(result.state, "WAIT_AUDIT_APPROVAL");
    assert.equal(result.workspace.sourceRoot, source);
    assert.equal(result.workspace.targetRoot, await realpath(target));
    assert.equal(result.pendingAuthorization.access, "read");
    assert.equal(result.health.healthy, true);
    assert.equal(await readFile(path.join(source, "old.md"), "utf8"), "# old\n");
  });
});

test("staged setup rolls back cleanly when initialization fails before commit", async () => {
  await withSetupSandbox(async ({ base, home, dataDir, binDir }) => {
    const root = path.join(base, "interrupted-personal-os");
    process.env.POS_TEST_FAIL_SETUP_AFTER_STAGE = "1";
    await assert.rejects(
      () => runSetup({ home, dataDir, binDir, agent: "generic", yes: true, workspaceMode: "new", root, initialize: true }),
      /Synthetic setup failure/u,
    );
    delete process.env.POS_TEST_FAIL_SETUP_AFTER_STAGE;
    assert.equal(await exists(root), false);
    assert.equal((await readdir(base)).some((name) => name.startsWith(".personal-os-init-")), false);
  });
});

test("setup command emits the stable machine schema and completes new-root initialization without a global CLI", async () => {
  await withSetupSandbox(async ({ base, home, dataDir, binDir }) => {
    const root = path.join(base, "command-personal-os");
    const { stdout } = await execFileAsync(process.execPath, [
      path.resolve("scripts/install.mjs"),
      "setup",
      "--agent", "generic",
      "--data-dir", dataDir,
      "--bin-dir", binDir,
      "--yes",
      "--workspace-mode", "new",
      "--root", root,
      "--initialize",
      "--json",
    ], { cwd: path.resolve("."), env: { ...process.env, HOME: home } });
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.schema, "personal-os.setup.v1");
    assert.equal(payload.result.state, "FIRST_REAL_TASK");
    assert.equal(payload.result.installation.globalCliInstalled, false);
    assert.equal(payload.result.health.healthy, true);
    assert.equal(await exists(path.join(root, "START_HERE.md")), true);
    assert.equal(await exists(path.join(binDir, "pos")), false);
  });
});
