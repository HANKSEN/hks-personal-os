import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALL_AGENT_TARGETS,
  detectAgentHosts,
  hostRegistry,
  normalizeAgentId,
  resolveAgentSelection,
} from "../scripts/lib/host-registry.mjs";

test("normalizes documented aliases without guessing unknown products", () => {
  assert.equal(normalizeAgentId("Claude-Code"), "claude");
  assert.equal(normalizeAgentId("open-claw"), "openclaw");
  assert.equal(normalizeAgentId("TRAE_SOLO"), "trae-solo");
  assert.equal(normalizeAgentId("unknown-agent"), null);
  assert.ok(ALL_AGENT_TARGETS.includes("workbuddy"));
  assert.ok(ALL_AGENT_TARGETS.includes("codebuddy"));
});

test("explicit host selection uses verified native roots and one shared fallback", () => {
  const home = path.resolve("/tmp/pos-host-registry-home");
  const selection = resolveAgentSelection({
    agentOption: "openclaw,hermes,workbuddy,codebuddy,trae,trae-solo,codex,claude",
    home,
    detected: {},
  });
  const paths = new Map(selection.targets.map((item) => [item.parent, item]));
  assert.ok(paths.has(path.join(home, ".openclaw", "skills")));
  assert.ok(paths.has(path.join(home, ".hermes", "skills")));
  assert.ok(paths.has(path.join(home, ".codex", "skills")));
  assert.ok(paths.has(path.join(home, ".claude", "skills")));
  const shared = paths.get(path.join(home, ".agents", "skills"));
  assert.deepEqual(shared.hosts.sort(), ["codebuddy", "trae", "trae-solo", "workbuddy"]);
  assert.equal(shared.name, "generic");
});

test("auto detection uses only observed host signals", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "personal-os-host-registry-"));
  try {
    await mkdir(path.join(home, ".openclaw"));
    await mkdir(path.join(home, ".workbuddy"));
    const detected = await detectAgentHosts({ home, env: { PATH: "" } });
    const selection = resolveAgentSelection({ agentOption: "auto", home, detected });
    assert.deepEqual(selection.selected.sort(), ["generic", "openclaw", "workbuddy"]);
    assert.equal(selection.adapters.find((item) => item.host === "workbuddy").pluginManifest, ".workbuddy-plugin/plugin.json");
    assert.equal(selection.adapters.some((item) => item.host === "trae"), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("registry exposes evidence and support grades for every accepted target", () => {
  const registry = hostRegistry();
  assert.equal(registry.length, ALL_AGENT_TARGETS.length);
  assert.equal(registry.every((item) => item.evidence.startsWith("https://")), true);
  assert.equal(registry.find((item) => item.id === "hermes").support, "verified-native");
  assert.equal(registry.find((item) => item.id === "trae").support, "standard-fallback");
});
