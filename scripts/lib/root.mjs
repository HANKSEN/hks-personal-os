import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PosError, invariant } from "./errors.mjs";
import { AI_WORKSPACE_LAYOUT, initializeAIWorkspace, workspaceLayout } from "./ai-workspace.mjs";
import { atomicWrite, ensureDir, exists, isoNow, readJson, writeJsonAtomic } from "./io.mjs";
import { assertNoSymlinkComponents, assertRootNotSymlink, resolveInside, safeComponent } from "./safe-path.mjs";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(CURRENT_DIR, "..", "..", "assets", "templates");
const ROOT_DIRS = [
  "00_Inbox",
  "10_Projects",
  "20_Areas",
  "30_Resources",
  "90_Archive",
  "99_AI/hosts",
  "99_AI/shared/handoffs",
  "99_AI/trash",
  ".pos/history",
  ".pos/transactions",
];
const LEGACY_ROOT_DIRS = [
  "00_Inbox",
  "10_Projects",
  "20_Areas",
  "30_Resources",
  "90_Archive",
  "99_AI/agents",
  "99_AI/runs",
  "99_AI/proposed",
  "99_AI/trash",
  ".pos/history",
  ".pos/transactions",
];

async function readTemplate(name) {
  return readFile(path.join(TEMPLATE_DIR, name), "utf8");
}

function testMode() {
  return process.env.POS_TEST_MODE === "1";
}

export async function assertTestRoot(root) {
  if (!testMode()) return;
  const resolved = await realpath(path.resolve(root));
  const tempRoot = await realpath(path.resolve(os.tmpdir()));
  const relative = path.relative(tempRoot, resolved);
  invariant(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "TEST_ROOT_OUTSIDE_TEMP", "Test roots must be inside the operating-system temporary directory.", { root: resolved }, 3);
  invariant(relative.split(path.sep).some((part) => part.startsWith("personal-os-test-")), "TEST_ROOT_INVALID_PREFIX", "Test root must use the personal-os-test- prefix.", { root: resolved }, 3);
  const markerPath = path.join(resolved, ".pos-test-fixture");
  invariant(await exists(markerPath), "TEST_MARKER_MISSING", "Test root is missing .pos-test-fixture.", { root: resolved }, 3);
  const expected = process.env.POS_TEST_RUN_ID;
  if (expected) {
    const actual = (await readFile(markerPath, "utf8")).trim();
    invariant(actual === expected, "TEST_MARKER_MISMATCH", "Test root marker does not match the current test run.", { root: resolved }, 3);
  }
}

export async function openRoot(rootInput) {
  invariant(typeof rootInput === "string" && rootInput.trim(), "ROOT_REQUIRED", "An explicit Personal OS root is required.", undefined, 3);
  const requestedRoot = path.resolve(rootInput);
  await assertTestRoot(requestedRoot);
  invariant(await exists(requestedRoot), "ROOT_NOT_FOUND", "Personal OS root does not exist.", { root: requestedRoot }, 3);
  await assertRootNotSymlink(requestedRoot);
  const root = await realpath(requestedRoot);
  const markerRelative = ".pos/project.json";
  await assertNoSymlinkComponents(root, markerRelative);
  const markerPath = path.join(root, markerRelative);
  invariant(await exists(markerPath), "ROOT_MARKER_MISSING", "Directory is not an initialized Personal OS root.", { root }, 3);
  const marker = await readJson(markerPath);
  invariant(marker?.schema === "pos.project.v1" && typeof marker.projectId === "string", "INVALID_ROOT_MARKER", "Invalid Personal OS root marker.", { root }, 3);
  const aiPaths = workspaceLayout(marker) === AI_WORKSPACE_LAYOUT
    ? ["99_AI/hosts", "99_AI/shared", "99_AI/trash"]
    : ["99_AI/agents", "99_AI/runs", "99_AI/proposed", "99_AI/trash"];
  for (const relative of [
    ".pos/policy.json",
    ".pos/index.jsonl",
    ".pos/index.meta.json",
    ".pos/audit.jsonl",
    ".pos/history",
    ".pos/transactions",
    ".pos/lock",
    ...aiPaths,
  ]) {
    await assertNoSymlinkComponents(root, relative);
  }
  return { root, marker };
}

export async function initializeRoot(rootInput, { areas = [], mode = "collaborative" } = {}) {
  invariant(typeof rootInput === "string" && rootInput.trim(), "ROOT_REQUIRED", "An explicit target directory is required.", undefined, 3);
  invariant(["safe", "collaborative", "trusted"].includes(mode), "INVALID_MODE", "Permission mode must be safe, collaborative, or trusted.", { mode }, 2);
  const validatedAreas = [...new Set(areas.map((rawArea) => safeComponent(rawArea, "Area name")))];
  let root = path.resolve(rootInput);

  if (!(await exists(root))) {
    invariant(!testMode(), "TEST_MARKER_MISSING", "Tests must create and mark their sandbox before initialization.", { root }, 3);
    await mkdir(root, { recursive: false });
  }
  await assertTestRoot(root);
  await assertRootNotSymlink(root);
  root = await realpath(root);

  const entries = await readdir(root);
  const allowedExisting = testMode() ? [".pos-test-fixture"] : [];
  const unexpected = entries.filter((entry) => !allowedExisting.includes(entry));
  invariant(unexpected.length === 0, "NON_EMPTY_TARGET", "Initialization target must be empty. Existing systems are not taken over by v1.", { root, entries: unexpected }, 3);

  for (const directory of ROOT_DIRS) await ensureDir(resolveInside(root, directory));
  await initializeAIWorkspace(root);

  const areaList = validatedAreas.length ? validatedAreas.map((area) => `- ${area}`).join("\n") : "- None yet";
  const rootContext = (await readTemplate("POS.md"))
    .replace("- Example Area", areaList)
    .replace("- Default mode: collaborative", `- Default mode: ${mode}`);
  await atomicWrite(path.join(root, "POS.md"), rootContext);
  await atomicWrite(path.join(root, "START_HERE.md"), await readTemplate("START_HERE.md"));
  const policy = JSON.parse(await readTemplate("policy.json"));
  policy.mode = mode;
  await writeJsonAtomic(path.join(root, ".pos", "policy.json"), policy);
  const marker = {
    schema: "pos.project.v1",
    projectId: randomUUID(),
    createdAt: isoNow(),
    version: 1,
    aiWorkspaceLayout: AI_WORKSPACE_LAYOUT,
  };
  await writeJsonAtomic(path.join(root, ".pos", "project.json"), marker);
  await atomicWrite(path.join(root, ".pos", "index.jsonl"), "");
  await writeJsonAtomic(path.join(root, ".pos", "index.meta.json"), {
    schema: "pos.index-meta.v1",
    projectId: marker.projectId,
    generatedAt: null,
    records: 0,
    sourceDigest: null,
  });
  await atomicWrite(path.join(root, ".pos", "audit.jsonl"), "");

  const areaTemplate = await readTemplate("AREA_CONTEXT.md");
  for (const area of validatedAreas) {
    const areaRoot = path.join(root, "20_Areas", area);
    await ensureDir(areaRoot);
    for (const asset of ["Knowledge", "Experience", "Principles", "Artifacts", "Data"]) {
      await ensureDir(path.join(areaRoot, asset));
    }
    const context = areaTemplate.replace(/^area:\s*$/mu, `area: ${JSON.stringify(area)}`).replace("# Area Context", `# ${area}`);
    await atomicWrite(path.join(areaRoot, "CONTEXT.md"), context);
  }

  return { root, marker, areas: validatedAreas, mode };
}

export { LEGACY_ROOT_DIRS, ROOT_DIRS };
