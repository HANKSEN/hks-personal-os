import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { exists, sha256File } from "../scripts/lib/io.mjs";
import { createProposal, withSandbox } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const cli = path.resolve("scripts/pos.mjs");

async function run(args) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: path.resolve("."),
    env: { ...process.env },
    maxBuffer: 4 * 1024 * 1024,
  });
}

test("CLI exposes help and operates only on explicit generated roots", async () => {
  await withSandbox(async ({ base, root, runId }) => {
    const help = await run(["help"]);
    assert.match(help.stdout, /No command searches parent directories/u);
    const jsonHelp = JSON.parse((await run(["help", "--json"])).stdout);
    assert.equal(jsonHelp.ok, true);
    assert.equal(jsonHelp.command, "help");
    assert.equal(jsonHelp.result.schema, "pos.help.v1");
    assert.deepEqual(jsonHelp.result.commands, ["init", "index", "context", "run", "apply", "undo", "doctor", "audit", "migrate-stage", "migrate-finalize", "workspace-upgrade", "help"]);

    const secondary = path.join(base, "secondary-vault");
    await mkdir(secondary);
    await writeFile(path.join(secondary, ".pos-test-fixture"), `${runId}\n`);
    const initialized = JSON.parse((await run(["init", secondary, "--areas", "虚构领域", "--json"])).stdout);
    assert.equal(initialized.ok, true);

    const indexed = JSON.parse((await run(["index", root, "--json"])).stdout);
    assert.equal(indexed.result.meta.schema, "pos.index-meta.v1");
    const context = JSON.parse((await run(["context", root, "--query", "示例领域", "--area", "示例领域", "--json"])).stdout);
    assert.equal(context.result.schema, "pos.context.v1");
    const task = JSON.parse((await run(["run", root, "--goal", "虚构 CLI 任务", "--host", "codex", "--role", "reviewer", "--area", "示例领域", "--json"])).stdout);
    assert.match(task.result.run, /^99_AI\/hosts\/codex\/runs\//u);
    assert.equal(task.result.task.hostId, "codex");
    assert.equal(task.result.task.roleId, "reviewer");
    assert.equal(task.result.task.writeScope.includes("20_Areas/示例领域/**"), true);
    const doctor = JSON.parse((await run(["doctor", root, "--json"])).stdout);
    assert.equal(doctor.result.healthy, true);
    assert.equal(doctor.result.issues.some((issue) => issue.code === "INCOMPLETE_RUN"), true);
    const workspaceUpgrade = JSON.parse((await run(["workspace-upgrade", root, "--json"])).stdout);
    assert.equal(workspaceUpgrade.result.upToDate, true);
    assert.equal(workspaceUpgrade.result.applied, false);
  });
});

test("CLI parses explicit false safety flags as false", async () => {
  await withSandbox(async ({ root }) => {
    const destination = "20_Areas/示例领域/Knowledge/cli-boolean.md";
    const proposal = await createProposal(root, {
      goal: "验证 CLI 布尔授权",
      writeScope: ["20_Areas/示例领域/Knowledge/**"],
      operations: [{ id: "create", action: "create", path: destination, sourceContent: "# CLI boolean\n", reason: "synthetic" }],
    });
    const preview = JSON.parse((await run(["apply", root, proposal.changesetPath, "--yes", "false", "--json"])).stdout);
    assert.equal(preview.result.applied, false);
    assert.equal(await exists(path.join(root, destination)), false);
    const applied = JSON.parse((await run(["apply", root, proposal.changesetPath, "--yes", "true", "--json"])).stdout);
    assert.equal(applied.result.applied, true);
    const undone = JSON.parse((await run(["undo", root, proposal.taskId, "--yes", "true", "--json"])).stdout);
    assert.equal(undone.result.undone, true);
    assert.equal(await exists(path.join(root, destination)), false);

    const posPath = path.join(root, "POS.md");
    const originalHash = await sha256File(posPath);
    const protectedProposal = await createProposal(root, {
      goal: "验证保护授权 false",
      writeScope: ["POS.md"],
      operations: [{ id: "update", action: "update", path: "POS.md", expectedHash: originalHash, sourceContent: "# Rejected\n", reason: "synthetic" }],
    });
    await assert.rejects(
      () => run(["apply", root, protectedProposal.changesetPath, "--yes", "true", "--approve-protected", "false", "--json"]),
      (error) => error.code === 7,
    );
    assert.equal(await sha256File(posPath), originalHash);
  });
});

test("CLI exposes a machine-readable read-only audit without changing the source", async () => {
  await withSandbox(async ({ base, root }) => {
    const source = path.join(base, "legacy-cli-source");
    await mkdir(source);
    const note = path.join(source, "review.md");
    await writeFile(note, "# Synthetic review\n\nSource must remain unchanged.\n");
    const before = await sha256File(note);
    const payload = JSON.parse((await run([
      "audit", root,
      "--source", source,
      "--yes-read", "true",
      "--json",
    ])).stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "audit");
    assert.equal(payload.result.schema, "personal-os.audit-result.v1");
    assert.equal(payload.result.sourceDigestBefore, payload.result.sourceDigestAfter);
    assert.equal(await exists(path.join(root, payload.result.plan)), true);
    assert.equal(await sha256File(note), before);
  });
});
