import { createHash } from "node:crypto";
import path from "node:path";

import { invariant } from "./errors.mjs";
import { atomicWrite, exists, isoNow, readJsonl, readTextBounded, sha256File, writeJsonAtomic } from "./io.mjs";
import { markdownInfo, tokenize } from "./markdown.mjs";
import { canRead, ignoredByIndex, loadPolicy } from "./policy.mjs";
import { openRoot } from "./root.mjs";
import { matchesAny, walkSafe } from "./safe-path.mjs";

const INDEXABLE = new Set([".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".csv"]);
const FIXED_SKIP_DIRS = new Set([".git", ".pos", "node_modules", "99_AI/runs", "99_AI/trash"]);

function skipPath(policy, relative, entry) {
  if (FIXED_SKIP_DIRS.has(relative)) return true;
  if (entry.isDirectory() && [...FIXED_SKIP_DIRS].some((prefix) => relative.startsWith(`${prefix}/`))) return true;
  return ignoredByIndex(policy, relative);
}

export async function buildIndex(rootInput, { write = true, rebuild = false } = {}) {
  const { root, marker } = await openRoot(rootInput);
  const policy = await loadPolicy(root);
  const indexPath = path.join(root, ".pos", "index.jsonl");
  const previousRecords = !rebuild && (await exists(indexPath)) ? await readJsonl(indexPath) : [];
  const previousByPath = new Map(previousRecords.map((record) => [record.path, record]));
  const { files, symlinks } = await walkSafe(root, {
    skip: (relative, entry) => skipPath(policy, relative, entry),
  });
  const records = [];
  let reusedRecords = 0;
  for (const file of files) {
    const extension = path.extname(file.relative).toLowerCase();
    if (!INDEXABLE.has(extension) || !canRead(policy, file.relative)) continue;
    const previous = previousByPath.get(file.relative);
    if (previous && previous.mtimeMs === file.info.mtimeMs && previous.size === file.info.size) {
      records.push(previous);
      reusedRecords += 1;
      continue;
    }
    const { text, truncated, size } = await readTextBounded(file.absolute);
    const info = markdownInfo(text, file.relative);
    records.push({
      schema: "pos.index.v1",
      ...info,
      path: file.relative,
      truncated,
      mtimeMs: file.info.mtimeMs,
      size,
      sha256: await sha256File(file.absolute),
    });
  }
  records.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const digest = createHash("sha256");
  for (const record of records) digest.update(`${record.path}\0${record.sha256}\n`);
  const meta = {
    schema: "pos.index-meta.v1",
    projectId: marker.projectId,
    generatedAt: isoNow(),
    records: records.length,
    sourceDigest: digest.digest("hex"),
    skippedSymlinks: symlinks,
    reusedRecords,
  };
  if (write) {
    const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
    await atomicWrite(indexPath, jsonl ? `${jsonl}\n` : "");
    await writeJsonAtomic(path.join(root, ".pos", "index.meta.json"), meta);
  }
  return { root, records, meta };
}

export async function loadIndex(rootInput) {
  const { root } = await openRoot(rootInput);
  return readJsonl(path.join(root, ".pos", "index.jsonl"));
}

export function searchIndex(records, query, options = {}) {
  const queryTokens = tokenize(query);
  const area = options.area ? String(options.area).toLowerCase() : null;
  const project = options.project ? String(options.project).toLowerCase() : null;
  const scored = [];
  for (const record of records) {
    if (record.type === "context") continue;
    const titleTokens = new Set(tokenize(record.title));
    const pathTokens = new Set(tokenize(record.path));
    const metadataTokens = new Set(tokenize([record.type, record.status, record.area, record.project, ...(record.tags ?? [])].join(" ")));
    const headingTokens = new Set(tokenize((record.headings ?? []).join(" ")));
    const excerptTokens = new Set(tokenize(record.excerpt));
    let score = 0;
    const reasons = [];
    for (const token of queryTokens) {
      if (titleTokens.has(token) || pathTokens.has(token)) {
        score += 8;
        reasons.push(`title/path:${token}`);
      }
      if (metadataTokens.has(token)) {
        score += 5;
        reasons.push(`metadata:${token}`);
      }
      if (headingTokens.has(token)) {
        score += 3;
        reasons.push(`heading:${token}`);
      }
      if (excerptTokens.has(token)) {
        score += 1;
        reasons.push(`excerpt:${token}`);
      }
    }
    if (area && String(record.area ?? "").toLowerCase() === area) {
      score += 6;
      reasons.push("area");
    }
    if (project && String(record.project ?? "").toLowerCase() === project) {
      score += 6;
      reasons.push("project");
    }
    if (!queryTokens.length && (area || project)) score += 1;
    if (score > 0) scored.push({ record, score, reasons: [...new Set(reasons)] });
  }
  scored.sort((a, b) => b.score - a.score || b.record.mtimeMs - a.record.mtimeMs || a.record.path.localeCompare(b.record.path, "en"));
  return scored.slice(0, options.limit ?? 8);
}

export async function ensureIndex(rootInput) {
  const { root } = await openRoot(rootInput);
  const records = await readJsonl(path.join(root, ".pos", "index.jsonl"));
  if (records.length) return { root, records };
  return buildIndex(root, { write: true });
}
