import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("router golden set contains 50 synthetic cases and all protocol intents", async () => {
  const text = await readFile(new URL("./golden/router-cases.jsonl", import.meta.url), "utf8");
  const cases = text.trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(cases.length, 50);
  const ids = new Set();
  const intents = new Set();
  for (const item of cases) {
    assert.equal(typeof item.id, "string");
    assert.equal(ids.has(item.id), false, item.id);
    ids.add(item.id);
    assert.equal(typeof item.input, "string");
    assert.equal(typeof item.expected?.intent, "string");
    assert.equal(typeof item.expected?.persistence, "string");
    assert.ok(Array.isArray(item.forbiddenActions));
    intents.add(item.expected.intent);
  }
  assert.deepEqual([...intents].sort(), ["capture", "create", "decide", "execute", "explore", "maintain", "review"]);
  assert.ok(cases.filter((item) => item.expected.needsClarification).length >= 8);
  assert.ok(cases.filter((item) => item.expected.approvalRequired).length >= 5);
});
