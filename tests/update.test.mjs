import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createRollbackPlan,
  createUpdatePlan,
  installPackage,
  rollbackPackage,
  updatePackage,
} from "../scripts/install.mjs";
import { exists, hashPath } from "../scripts/lib/io.mjs";
import { buildPackageManifest, verifyInstalledPackage } from "../scripts/lib/package-integrity.mjs";

const execFileAsync = promisify(execFile);

async function withUpdateSandbox(callback) {
  const base = await mkdtemp(path.join(os.tmpdir(), "personal-os-update-test-"));
  const home = path.join(base, "home");
  const dataDir = path.join(base, "software", "personal-os");
  const binDir = path.join(base, "bin");
  const personalRoot = path.join(base, "personal-data");
  await mkdir(home, { recursive: true });
  await mkdir(personalRoot, { recursive: true });
  await writeFile(path.join(personalRoot, "private.md"), "private personal data\n");
  const before = await hashPath(personalRoot);
  try {
    return await callback({ base, home, dataDir, binDir, personalRoot });
  } finally {
    delete process.env.POS_TEST_FAIL_UPDATE_AFTER_LINKS;
    assert.equal(await hashPath(personalRoot), before, "software update must not access or modify personal data");
    await rm(base, { recursive: true, force: true });
  }
}

async function makeLegacyInstall({ dataDir, home, binDir, version = "0.9.0", withCli = true, skillParent = path.join(home, ".agents", "skills") }) {
  const versionDir = path.join(dataDir, "versions", version);
  await mkdir(path.join(versionDir, "scripts"), { recursive: true });
  await writeFile(path.join(versionDir, "SKILL.md"), `# Legacy ${version}\n`);
  await writeFile(path.join(versionDir, "scripts", "pos.mjs"), "#!/usr/bin/env node\n");
  await writeFile(path.join(versionDir, "scripts", "install.mjs"), "#!/usr/bin/env node\n");
  await writeFile(path.join(versionDir, ".personal-os-install.json"), `${JSON.stringify({
    schema: "personal-os.install.v1",
    package: "personal-os",
    version,
  })}\n`);

  const skill = path.join(skillParent, "personal-os");
  await mkdir(path.dirname(skill), { recursive: true });
  await symlink(versionDir, skill);
  const binaries = [];
  if (withCli) {
    await mkdir(binDir, { recursive: true });
    const pos = path.join(binDir, "pos");
    const installer = path.join(binDir, "personal-os");
    await symlink(path.join(versionDir, "scripts", "pos.mjs"), pos);
    await symlink(path.join(versionDir, "scripts", "install.mjs"), installer);
    binaries.push(pos, installer);
  }
  return { versionDir, skill, binaries };
}

test("update upgrades a legacy Skill, preserves its optional CLI, and records verified software-only state", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir, personalRoot }) => {
    const legacy = await makeLegacyInstall({ dataDir, home, binDir });
    const preview = await createUpdatePlan({ home, dataDir, binDir, agent: "auto" });
    assert.deepEqual(preview.currentVersions, ["0.9.0"]);
    assert.equal(preview.direction, "upgrade");
    assert.equal(preview.skills.length, 1);
    assert.equal(preview.binaries.length, 2, "existing optional CLI must remain managed without --with-cli");
    assert.deepEqual(preview.dataRootsAccessed, []);
    assert.equal(preview.dataMigration, "not-performed");

    const result = await updatePackage({ home, dataDir, binDir, agent: "auto", yes: true });
    assert.equal(result.applied, true);
    assert.equal(result.integrity, "verified");
    assert.notEqual(await readlink(legacy.skill), legacy.versionDir);
    for (const binary of legacy.binaries) assert.notEqual(path.resolve(path.dirname(binary), await readlink(binary)), legacy.versionDir);

    const activeVersionDir = path.join(dataDir, "versions", result.version);
    const verified = await verifyInstalledPackage(activeVersionDir, { packageName: "personal-os", version: result.version, allowLegacy: false });
    assert.equal(verified.status, "verified");
    assert.equal(await exists(legacy.versionDir), true, "previous version must remain available for rollback");

    const stateText = await readFile(path.join(dataDir, "install-state.json"), "utf8");
    const state = JSON.parse(stateText);
    assert.equal(state.activeVersion, result.version);
    assert.equal(state.previousVersion, "0.9.0");
    assert.equal(state.skills.length, 1);
    assert.equal(state.binaries.length, 2);
    assert.equal(stateText.includes(personalRoot), false, "install state must not contain Personal OS data roots");
  });
});

test("rollback activates an installed previous version without touching Personal OS data", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    const legacy = await makeLegacyInstall({ dataDir, home, binDir });
    const updated = await updatePackage({ home, dataDir, binDir, agent: "generic", yes: true });
    assert.notEqual(updated.version, "0.9.0");

    const preview = await createRollbackPlan({ home, dataDir, binDir, to: "0.9.0" });
    assert.equal(preview.direction, "rollback");
    assert.equal(preview.targetIntegrity, "legacy-unverified");
    assert.match(preview.dataBoundary, /does not reverse or access/u);

    const result = await rollbackPackage({ home, dataDir, binDir, to: "0.9.0", yes: true });
    assert.equal(result.applied, true);
    assert.equal(result.version, "0.9.0");
    assert.equal(path.resolve(path.dirname(legacy.skill), await readlink(legacy.skill)), legacy.versionDir);
    assert.deepEqual(result.dataRootsAccessed, []);
    assert.equal(result.dataMigration, "not-reverted");
  });
});

test("update refuses a tampered installed package", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    const installed = await installPackage({ home, dataDir, binDir, agent: "generic", yes: true });
    await writeFile(path.join(installed.installDir, "SKILL.md"), "# tampered\n");
    await assert.rejects(
      () => createUpdatePlan({ home, dataDir, binDir, agent: "generic" }),
      (error) => error.code === "INSTALL_INTEGRITY_MISMATCH",
    );
  });
});

test("failed multi-link update restores every previous software link", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    const legacy = await makeLegacyInstall({ dataDir, home, binDir });
    const beforeSkill = await readlink(legacy.skill);
    const beforeBinaries = await Promise.all(legacy.binaries.map((item) => readlink(item)));
    process.env.POS_TEST_FAIL_UPDATE_AFTER_LINKS = "2";
    await assert.rejects(
      () => updatePackage({ home, dataDir, binDir, agent: "generic", yes: true }),
      /Synthetic link transaction failure/u,
    );
    assert.equal(await readlink(legacy.skill), beforeSkill);
    assert.deepEqual(await Promise.all(legacy.binaries.map((item) => readlink(item))), beforeBinaries);
    assert.equal(await exists(path.join(dataDir, "install-state.json")), false);
  });
});

test("update does not invent an installation and rollback requires an installed target", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    await assert.rejects(
      () => createUpdatePlan({ home, dataDir, binDir, agent: "auto" }),
      (error) => error.code === "NO_MANAGED_INSTALLATION",
    );
    await assert.rejects(
      () => createRollbackPlan({ home, dataDir, binDir, to: "0.1.0" }),
      (error) => error.code === "ROLLBACK_VERSION_NOT_INSTALLED",
    );
  });
});

test("install state remembers an existing optional CLI when a later Skill-only install adds another host", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    await installPackage({ home, dataDir, binDir, agent: "generic", withCli: true, yes: true });
    await installPackage({ home, dataDir, binDir, agent: "codex", yes: true });
    const state = JSON.parse(await readFile(path.join(dataDir, "install-state.json"), "utf8"));
    assert.equal(state.skills.length, 2);
    assert.equal(state.binaries.length, 2);
    assert.equal((await lstat(path.join(binDir, "pos"))).isSymbolicLink(), true);
  });
});

test("update supports an explicitly configured custom Skill target without prior install state", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    const customParent = path.join(home, "custom-agent", "skills");
    const legacy = await makeLegacyInstall({ dataDir, home, binDir, withCli: false, skillParent: customParent });
    const result = await updatePackage({
      home,
      dataDir,
      binDir,
      agent: "none",
      skillDirs: [customParent],
      yes: true,
    });
    assert.equal(result.applied, true);
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].path, legacy.skill);
    assert.notEqual(path.resolve(path.dirname(legacy.skill), await readlink(legacy.skill)), legacy.versionDir);
  });
});

test("an internally valid but different package cannot reuse the same immutable version", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    const installed = await installPackage({ home, dataDir, binDir, agent: "generic", yes: true });
    const markerPath = path.join(installed.installDir, ".personal-os-install.json");
    await writeFile(path.join(installed.installDir, "SKILL.md"), "# different content under the same version\n");
    const differentManifest = await buildPackageManifest(installed.installDir, { packageName: "personal-os", version: installed.version });
    await writeFile(path.join(installed.installDir, ".personal-os-manifest.json"), `${JSON.stringify(differentManifest, null, 2)}\n`);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.packageDigest = differentManifest.digest;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);

    await assert.rejects(
      () => createUpdatePlan({ home, dataDir, binDir, agent: "generic" }),
      (error) => error.code === "IMMUTABLE_VERSION_MISMATCH",
    );
  });
});

test("installer command exposes machine-readable update and rollback previews", async () => {
  await withUpdateSandbox(async ({ home, dataDir, binDir }) => {
    await makeLegacyInstall({ dataDir, home, binDir, withCli: false });
    const script = path.resolve("scripts/install.mjs");
    const environment = { ...process.env, HOME: home };
    const update = await execFileAsync(process.execPath, [
      script,
      "update",
      "--agent", "generic",
      "--data-dir", dataDir,
      "--bin-dir", binDir,
      "--dry-run",
      "--json",
    ], { env: environment });
    const updatePayload = JSON.parse(update.stdout);
    assert.equal(updatePayload.result.plan.schema, "personal-os.update-plan.v1");
    assert.deepEqual(updatePayload.result.plan.dataRootsAccessed, []);

    await updatePackage({ home, dataDir, binDir, agent: "generic", yes: true });
    const rollback = await execFileAsync(process.execPath, [
      script,
      "rollback",
      "--to", "0.9.0",
      "--data-dir", dataDir,
      "--bin-dir", binDir,
      "--dry-run",
      "--json",
    ], { env: environment });
    const rollbackPayload = JSON.parse(rollback.stdout);
    assert.equal(rollbackPayload.result.plan.schema, "personal-os.rollback-plan.v1");
    assert.equal(rollbackPayload.result.plan.targetVersion, "0.9.0");
  });
});
