import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRun } from "../scripts/lib/runs.mjs";
import { hashPath, writeJsonAtomic } from "../scripts/lib/io.mjs";
import { initializeRoot } from "../scripts/lib/root.mjs";
import { resolveInside } from "../scripts/lib/safe-path.mjs";

export async function withSandbox(callback, options = {}) {
  const runId = randomUUID();
  const base = await mkdtemp(path.join(os.tmpdir(), "personal-os-test-"));
  const root = path.join(base, "vault");
  const fakeHome = path.join(base, "fake-home");
  const outside = path.join(base, "outside-canary");
  await mkdir(root);
  await mkdir(fakeHome);
  await mkdir(outside);
  await writeFile(path.join(root, ".pos-test-fixture"), `${runId}\n`);
  await writeFile(path.join(outside, "canary.txt"), "outside must remain unchanged\n");
  const outsideBefore = await hashPath(outside);
  const oldEnvironment = {
    POS_TEST_MODE: process.env.POS_TEST_MODE,
    POS_TEST_RUN_ID: process.env.POS_TEST_RUN_ID,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  };
  Object.assign(process.env, {
    POS_TEST_MODE: "1",
    POS_TEST_RUN_ID: runId,
    HOME: fakeHome,
    XDG_CONFIG_HOME: path.join(fakeHome, ".config"),
    XDG_CACHE_HOME: path.join(fakeHome, ".cache"),
  });
  await initializeRoot(root, {
    areas: options.areas ?? ["示例领域", "软件项目", "研究决策"],
    mode: options.mode ?? "collaborative",
  });

  try {
    return await callback({ base, root, outside, fakeHome, runId });
  } finally {
    delete process.env.POS_TEST_FAIL_AFTER_OPERATIONS;
    delete process.env.POS_TEST_FAIL_DURING_UNDO;
    delete process.env.POS_TEST_FAIL_AFTER_UNDO_STATUS;
    delete process.env.POS_TEST_INTERFERE_BEFORE_OPERATION;
    delete process.env.POS_TEST_INTERFERE_PATH;
    delete process.env.POS_TEST_INTERFERE_CONTENT;
    const marker = (await readFile(path.join(root, ".pos-test-fixture"), "utf8")).trim();
    if (marker !== runId) throw new Error("Refusing sandbox cleanup because the test marker changed.");
    const outsideAfter = await hashPath(outside);
    if (outsideAfter !== outsideBefore) throw new Error("Outside-canary changed; sandbox is preserved for inspection.");
    if (!path.basename(base).startsWith("personal-os-test-") || !path.resolve(base).startsWith(path.resolve(os.tmpdir()))) {
      throw new Error("Refusing sandbox cleanup outside the test temporary prefix.");
    }
    await rm(base, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function writeFixture(root, relative, content) {
  const absolute = resolveInside(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
  return absolute;
}

export async function createProposal(root, { goal, writeScope, operations, area, project }) {
  const run = await createRun(root, { goal, area, project, writeScope });
  const normalizedOperations = [];
  for (const operation of operations) {
    const normalized = { ...operation };
    if (Object.hasOwn(operation, "sourceContent")) {
      const source = `${run.run}/proposed/${operation.id}.md`;
      await writeFixture(root, source, String(operation.sourceContent));
      normalized.source = source;
      delete normalized.sourceContent;
    }
    normalizedOperations.push(normalized);
  }
  const changeset = {
    schema: "pos.changeset.v1",
    taskId: run.taskId,
    summary: goal,
    writeScope,
    operations: normalizedOperations,
  };
  const relative = `${run.run}/CHANGESET.json`;
  await writeJsonAtomic(resolveInside(root, relative), changeset);
  return { ...run, changeset, changesetPath: relative };
}
