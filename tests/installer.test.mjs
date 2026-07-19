import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createInstallPlan, installPackage } from "../scripts/install.mjs";
import { exists, hashPath } from "../scripts/lib/io.mjs";

const execFileAsync = promisify(execFile);

async function withInstallerSandbox(callback) {
  const base = await mkdtemp(path.join(os.tmpdir(), "personal-os-installer-test-"));
  const marker = path.join(base, ".installer-test-fixture");
  const home = path.join(base, "home");
  const dataDir = path.join(base, "data", "personal-os");
  const binDir = path.join(base, "bin");
  const outside = path.join(base, "outside");
  await mkdir(home, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(marker, "synthetic installer fixture\n");
  await writeFile(path.join(outside, "canary.txt"), "must remain unchanged\n");
  const before = await hashPath(outside);
  try {
    return await callback({ base, home, dataDir, binDir, outside });
  } finally {
    assert.equal(await hashPath(outside), before);
    assert.equal((await readFile(marker, "utf8")).trim(), "synthetic installer fixture");
    assert.ok(path.basename(base).startsWith("personal-os-installer-test-"));
    await rm(base, { recursive: true, force: true });
  }
}

test("installer dry-run reports every target without writing", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    await mkdir(path.join(home, ".codex"));
    await mkdir(path.join(home, ".claude"));
    const result = await installPackage({ home, dataDir, binDir, agent: "auto", dryRun: true });
    assert.equal(result.applied, false);
    assert.equal(result.requiresApproval, false);
    assert.equal(result.plan.skills.length, 3);
    assert.deepEqual(result.plan.skills.map((item) => item.name).sort(), ["claude", "codex", "generic"]);
    assert.equal(await exists(result.plan.versionInstall.path), false);
    assert.equal(await exists(path.join(binDir, "pos")), false);
    assert.match(result.plan.warning, /independent backup/u);
    assert.match(result.plan.dataBoundary, /does not initialize/u);
  });
});

test("installer creates a stable Skill-first package without a global CLI by default", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    const customParent = path.join(home, "host", "skills");
    const first = await installPackage({
      home,
      dataDir,
      binDir,
      agent: "codex,claude",
      skillDirs: [customParent],
      yes: true,
    });
    assert.equal(first.applied, true);
    assert.equal(first.skills.length, 3);
    assert.equal(await exists(path.join(first.installDir, ".personal-os-install.json")), true);
    assert.equal(await exists(path.join(first.installDir, "SKILL.md")), true);
    assert.equal(await exists(path.join(first.installDir, "AGENT_SETUP.md")), true);
    assert.equal(await exists(path.join(first.installDir, "AGENT_INSTALL.md")), true);
    assert.equal(first.installMode, "skill-only");
    assert.equal(first.binaries.length, 0);
    assert.equal(await exists(path.join(binDir, "pos")), false);
    assert.equal(await exists(first.embeddedRuntime), true);
    assert.equal((await lstat(path.join(home, ".codex", "skills", "personal-os"))).isSymbolicLink(), true);
    assert.equal((await lstat(path.join(home, ".claude", "skills", "personal-os"))).isSymbolicLink(), true);
    assert.equal((await lstat(path.join(customParent, "personal-os"))).isSymbolicLink(), true);

    const help = await execFileAsync(process.execPath, [first.embeddedRuntime, "help"], { env: { ...process.env, HOME: home } });
    assert.match(help.stdout, /Personal OS CLI/u);
    assert.equal(await exists(path.join(home, "POS.md")), false);
    assert.equal(await exists(path.join(home, "00_Inbox")), false);

    const secondPlan = await createInstallPlan({ home, dataDir, binDir, agent: "codex,claude", skillDirs: [customParent] });
    assert.equal(secondPlan.versionInstall.action, "reuse");
    assert.equal(secondPlan.binaries.length, 0);
    assert.equal(secondPlan.skills.every((item) => item.action === "reuse"), true);
  });
});

test("installer exposes the optional global CLI only with withCli", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    const result = await installPackage({ home, dataDir, binDir, agent: "generic", withCli: true, yes: true });
    assert.equal(result.installMode, "skill-and-cli");
    assert.equal(result.binaries.length, 2);
    assert.equal((await lstat(path.join(binDir, "pos"))).isSymbolicLink(), true);
    const help = await execFileAsync(path.join(binDir, "pos"), ["help"], { env: { ...process.env, HOME: home } });
    assert.match(help.stdout, /Personal OS CLI/u);
  });
});

test("installer labels runtime-only fallback when no Skill target is configured", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    const result = await installPackage({ home, dataDir, binDir, agent: "none", yes: true });
    assert.equal(result.hostMode, "runtime-only-compatibility");
    assert.equal(result.compatibilityFallback, true);
    assert.equal(result.skills.length, 0);
    assert.equal(result.binaries.length, 0);
    assert.equal(await exists(result.embeddedRuntime), true);
    assert.match(result.next[0], /compatibility mode/u);
  });
});

test("installer refuses unrelated binary and Skill collisions", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    await mkdir(binDir, { recursive: true });
    const existingBinary = path.join(binDir, "pos");
    await writeFile(existingBinary, "unrelated command\n");
    await assert.rejects(
      () => createInstallPlan({ home, dataDir, binDir, agent: "none", withCli: true }),
      (error) => error.code === "INSTALL_LINK_COLLISION",
    );
    assert.equal(await readFile(existingBinary, "utf8"), "unrelated command\n");
  });

  await withInstallerSandbox(async ({ home, dataDir, binDir }) => {
    const skillDestination = path.join(home, ".codex", "skills", "personal-os");
    await mkdir(skillDestination, { recursive: true });
    await writeFile(path.join(skillDestination, "keep.txt"), "unrelated skill\n");
    await assert.rejects(
      () => createInstallPlan({ home, dataDir, binDir, agent: "codex" }),
      (error) => error.code === "INSTALL_LINK_COLLISION",
    );
    assert.equal(await readFile(path.join(skillDestination, "keep.txt"), "utf8"), "unrelated skill\n");
  });
});

test("installer CLI previews with synthetic HOME and never creates a data root", async () => {
  await withInstallerSandbox(async ({ base, home, dataDir, binDir }) => {
    const script = path.resolve("scripts/install.mjs");
    const npxStyleEntry = path.join(base, "personal-os");
    await symlink(script, npxStyleEntry);
    const { stdout } = await execFileAsync(npxStyleEntry, [
      "--agent", "generic",
      "--data-dir", dataDir,
      "--bin-dir", binDir,
      "--dry-run",
      "--json",
    ], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: path.join(home, ".local", "share"),
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.plan.compatibilityNotice, /Legacy install syntax/u);
    assert.equal(result.result.plan.binaries.length, 2);
    assert.equal(result.result.plan.skills[0].path, path.join(home, ".agents", "skills", "personal-os"));
    assert.equal(await exists(dataDir), false);
    assert.equal(await exists(path.join(home, "POS.md")), false);
  });
});

test("installer recognizes managed older-version links but not arbitrary symlinks", async () => {
  await withInstallerSandbox(async ({ home, dataDir, binDir, outside }) => {
    const versions = path.join(dataDir, "versions");
    const old = path.join(versions, "0.0.1");
    await mkdir(path.join(old, "scripts"), { recursive: true });
    await writeFile(path.join(old, ".personal-os-install.json"), `${JSON.stringify({ schema: "personal-os.install.v1", package: "personal-os", version: "0.0.1" })}\n`);
    await writeFile(path.join(old, "scripts", "pos.mjs"), "#!/usr/bin/env node\n");
    await writeFile(path.join(old, "SKILL.md"), "# Old\n");
    await mkdir(binDir, { recursive: true });
    await symlink(path.join(old, "scripts", "pos.mjs"), path.join(binDir, "pos"));
    await symlink(path.join(old, "scripts", "pos.mjs"), path.join(binDir, "personal-os"));
    const skillParent = path.join(home, ".agents", "skills");
    await mkdir(skillParent, { recursive: true });
    await symlink(old, path.join(skillParent, "personal-os"));
    const plan = await createInstallPlan({ home, dataDir, binDir, agent: "generic", withCli: true });
    assert.equal(plan.binaries.every((item) => item.action === "update"), true);
    assert.equal(plan.skills[0].action, "update");

    await rm(path.join(binDir, "pos"));
    await symlink(path.join(outside, "canary.txt"), path.join(binDir, "pos"));
    await assert.rejects(
      () => createInstallPlan({ home, dataDir, binDir, agent: "generic", withCli: true }),
      (error) => error.code === "INSTALL_LINK_COLLISION",
    );
    assert.equal(await readlink(path.join(binDir, "pos")), path.join(outside, "canary.txt"));
  });
});
