import assert from "node:assert/strict";
import test from "node:test";

import { retrieveContext } from "../scripts/lib/context.mjs";
import { buildIndex } from "../scripts/lib/indexer.mjs";
import { withSandbox, writeFixture } from "./helpers.mjs";

async function generateRange(root, start, end) {
  const batchSize = 100;
  for (let batch = start; batch < end; batch += batchSize) {
    const jobs = [];
    for (let index = batch; index < Math.min(end, batch + batchSize); index += 1) {
      const relevant = index === 42;
      jobs.push(
        writeFixture(
          root,
          `20_Areas/示例领域/Knowledge/Synthetic/note-${String(index).padStart(5, "0")}.md`,
          `---\nid: synthetic-note-${index}\ntype: knowledge\narea: 示例领域\n---\n# ${relevant ? "稀有目标术语" : `合成笔记 ${index}`}\n\n${relevant ? "这是唯一与稀有目标术语直接相关的合成内容。" : "这是用于索引压力测试的虚构文本。"}\n`,
        ),
      );
    }
    await Promise.all(jobs);
  }
}

test("10,000-file synthetic vault keeps retrieval bounded and avoids full-context growth", { timeout: 60000 }, async () => {
  await withSandbox(async ({ root }) => {
    const checkpoints = [];
    for (const [start, end] of [[0, 100], [100, 1000], [1000, 10000]]) {
      await generateRange(root, start, end);
      const started = Date.now();
      const indexed = await buildIndex(root);
      const durationMs = Date.now() - started;
      const context = await retrieveContext(root, {
        query: "稀有目标术语",
        area: "示例领域",
        maxFiles: 8,
        maxChars: 48000,
      });
      assert.equal(context.context.some((item) => item.path.endsWith("note-00042.md")), true);
      assert.ok(context.totals.retrievedAssets <= 8);
      assert.ok(context.totals.characters <= 48000);
      checkpoints.push({ records: indexed.records.length, tokens: context.totals.estimatedTokens, durationMs });
    }
    assert.ok(checkpoints[2].records >= 10000);
    assert.ok(checkpoints[2].durationMs < 30000, `10k incremental index took ${checkpoints[2].durationMs}ms`);
    assert.ok(checkpoints[2].tokens <= checkpoints[0].tokens * 1.25, JSON.stringify(checkpoints));
  });
});
