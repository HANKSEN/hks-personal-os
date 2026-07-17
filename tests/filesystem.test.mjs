import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { retrieveContext } from "../scripts/lib/context.mjs";
import { diagnose } from "../scripts/lib/doctor.mjs";
import { buildIndex } from "../scripts/lib/indexer.mjs";
import { exists, readJson, sha256File, writeJsonAtomic } from "../scripts/lib/io.mjs";
import { initializeRoot } from "../scripts/lib/root.mjs";
import { withSandbox, writeFixture } from "./helpers.mjs";

test("initializes only the generated empty test root", async () => {
  await withSandbox(async ({ base, root }) => {
    for (const relative of ["POS.md", "00_Inbox", "10_Projects", "20_Areas", "30_Resources", "90_Archive", "99_AI", ".pos/project.json"]) {
      assert.equal(await exists(path.join(root, relative)), true, relative);
    }
    const rootContext = await readFile(path.join(root, "POS.md"), "utf8");
    assert.match(rootContext, /- 示例领域/u);
    assert.doesNotMatch(rootContext, /Example Area/u);
    assert.match(rootContext, /Default mode: collaborative/u);
    const before = await sha256File(path.join(root, "POS.md"));
    await assert.rejects(() => initializeRoot(root), (error) => error.code === "NON_EMPTY_TARGET");
    assert.equal(await sha256File(path.join(root, "POS.md")), before);
    const unmarked = path.join(base, "unmarked-vault");
    await mkdir(unmarked);
    await assert.rejects(() => initializeRoot(unmarked), (error) => error.code === "TEST_MARKER_MISSING");
  });
});

test("indexes synthetic Markdown without modifying the source and retrieves bounded context", async () => {
  await withSandbox(async ({ root }) => {
    const file = await writeFixture(
      root,
      "20_Areas/示例领域/Knowledge/选题判断.md",
      "---\nid: knowledge-topic-selection\ntype: knowledge\nstatus: active\narea: 示例领域\ncreated: 2026-07-01\nupdated: 2026-07-02\n---\n\n# 选题判断\n\n先定义受众问题，再选择表达形式。\n",
    );
    const before = await sha256File(file);
    const indexed = await buildIndex(root);
    const indexedRecord = indexed.records.find((record) => record.id === "knowledge-topic-selection");
    assert.equal(indexedRecord?.type, "knowledge");
    assert.equal(indexedRecord?.created, "2026-07-01");
    assert.equal(indexedRecord?.updated, "2026-07-02");
    assert.equal(await sha256File(file), before);
    const incremental = await buildIndex(root);
    assert.ok(incremental.meta.reusedRecords > 0);

    const context = await retrieveContext(root, { query: "选题判断", area: "示例领域", maxFiles: 3, maxChars: 12000 });
    assert.equal(context.context.some((item) => item.path.endsWith("选题判断.md")), true);
    assert.ok(context.totals.characters <= 12000);
    assert.ok(context.totals.retrievedAssets <= 3);
    assert.equal(context.retrievalGap, false);

    const gap = await retrieveContext(root, { query: "zzqvnonexistent987654321" });
    assert.equal(gap.retrievalGap, true);
    assert.match(gap.gapReason, /No relevant durable asset/u);
  });
});

test("parses CRLF frontmatter without losing the first body heading", async () => {
  await withSandbox(async ({ root }) => {
    await writeFixture(
      root,
      "20_Areas/示例领域/Knowledge/crlf.md",
      "---\r\nid: knowledge-crlf\r\ntype: knowledge\r\nstatus: 待创作\r\ncreated_at: 2026-07-03\r\nupdated_at: 2026-07-04\r\n---\r\n# CRLF 标题\r\n\r\n正文。\r\n",
    );
    const indexed = await buildIndex(root, { rebuild: true });
    const record = indexed.records.find((item) => item.id === "knowledge-crlf");
    assert.equal(record?.title, "CRLF 标题");
    assert.equal(record?.status, "待创作");
    assert.equal(record?.created, "2026-07-03");
    assert.equal(record?.updated, "2026-07-04");
  });
});

test("loads the selected logical Agent manifest into an isolated Run", async () => {
  await withSandbox(async ({ root }) => {
    const { createRun } = await import("../scripts/lib/runs.mjs");
    const run = await createRun(root, { goal: "复盘虚构文章", agentId: "reviewer", area: "示例领域" });
    assert.equal(run.task.agentId, "reviewer");
    assert.equal(run.context.context.some((item) => item.path === "99_AI/agents/reviewer/AGENT.md"), true);
    assert.equal(run.task.writeScope.includes("20_Areas/示例领域/**"), true);
    const report = await diagnose(root);
    assert.equal(report.issues.some((issue) => issue.code === "INCOMPLETE_RUN" && issue.run === run.taskId && issue.status === "created"), true);
  });
});

test("skips symlinks and reports duplicate IDs without following the target", async () => {
  await withSandbox(async ({ root, outside }) => {
    await writeFixture(root, "20_Areas/示例领域/Knowledge/a.md", "---\nid: duplicate-id\n---\n# A\n");
    await writeFixture(root, "20_Areas/示例领域/Knowledge/b.md", "---\nid: duplicate-id\n---\n# B\n");
    await symlink(outside, path.join(root, "20_Areas", "示例领域", "Knowledge", "external-link"));
    const indexed = await buildIndex(root);
    assert.equal(indexed.meta.skippedSymlinks.some((item) => item.endsWith("external-link")), true);
    assert.equal(indexed.records.some((record) => record.path.includes("canary")), false);
    const report = await diagnose(root);
    assert.equal(report.issues.some((issue) => issue.code === "DUPLICATE_ID"), true);
    assert.equal(report.issues.some((issue) => issue.code === "SYMLINK_PRESENT"), true);
  });
});

test("rebuilds a removed index, drops stale moved paths, and honors deny-read rules", async () => {
  await withSandbox(async ({ root }) => {
    const oldPath = "20_Areas/示例领域/待创作/old.md";
    const newPath = "20_Areas/示例领域/待创作/new.md";
    await writeFixture(root, oldPath, "---\nid: custom-status-note\nstatus: 待创作\n---\n# Custom status\n");
    let indexed = await buildIndex(root, { rebuild: true });
    assert.equal(indexed.records.some((record) => record.path === oldPath && record.status === "待创作"), true);

    await rename(path.join(root, oldPath), path.join(root, newPath));
    indexed = await buildIndex(root);
    assert.equal(indexed.records.some((record) => record.path === oldPath), false);
    assert.equal(indexed.records.some((record) => record.path === newPath), true);

    await rm(path.join(root, ".pos", "index.jsonl"));
    indexed = await buildIndex(root);
    assert.equal(indexed.records.some((record) => record.path === newPath), true);

    const policyPath = path.join(root, ".pos", "policy.json");
    const policy = await readJson(policyPath);
    policy.denyRead.push("20_Areas/研究决策/Private/**");
    await writeJsonAtomic(policyPath, policy);
    await writeFixture(root, "20_Areas/研究决策/Private/secret.md", "---\nid: denied-secret\n---\n# Secret\n");
    indexed = await buildIndex(root, { rebuild: true });
    assert.equal(indexed.records.some((record) => record.id === "denied-secret"), false);
  });
});
