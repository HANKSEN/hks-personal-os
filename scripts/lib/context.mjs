import path from "node:path";

import { loadRoleProfile, resolveHostId, resolveRoleId } from "./ai-workspace.mjs";
import { PosError } from "./errors.mjs";
import { exists, readTextBounded, sha256File, sha256Text } from "./io.mjs";
import { ensureIndex, searchIndex } from "./indexer.mjs";
import { canRead, loadPolicy } from "./policy.mjs";
import { openRoot } from "./root.mjs";
import { assertNoSymlinkComponents, resolveInside, safeComponent } from "./safe-path.mjs";

export async function retrieveContext(rootInput, options = {}) {
  const { root } = await openRoot(rootInput);
  const policy = await loadPolicy(root);
  const maxFiles = Number(options.maxFiles ?? policy.maxContextFiles ?? 8);
  const maxChars = Number(options.maxChars ?? policy.maxContextChars ?? 48000);
  const query = String(options.query ?? "");
  const bundle = [];
  const seen = new Set();
  let usedChars = 0;

  const add = async (relative, reason, maxPerFile = maxChars) => {
    if (seen.has(relative) || !canRead(policy, relative)) return false;
    const absolute = resolveInside(root, relative);
    if (!(await exists(absolute))) return false;
    await assertNoSymlinkComponents(root, relative);
    const remaining = Math.max(0, Math.min(maxPerFile, maxChars - usedChars));
    if (!remaining) return false;
    const { text, truncated, size } = await readTextBounded(absolute, remaining);
    bundle.push({
      path: relative,
      reason,
      content: text,
      truncated: truncated || text.length < size,
      size,
      sha256: await sha256File(absolute),
      estimatedTokens: Math.ceil(text.length / 4),
    });
    usedChars += text.length;
    seen.add(relative);
    return true;
  };

  const addTrustedRole = async (roleIdInput) => {
    const profile = await loadRoleProfile(roleIdInput);
    if (seen.has(profile.path)) return false;
    const remaining = Math.max(0, Math.min(10000, maxChars - usedChars));
    if (!remaining) return false;
    const content = profile.content.slice(0, remaining);
    bundle.push({
      path: profile.path,
      reason: "trusted-role-profile",
      content,
      truncated: content.length < profile.content.length,
      size: profile.content.length,
      sha256: sha256Text(profile.content),
      estimatedTokens: Math.ceil(content.length / 4),
    });
    usedChars += content.length;
    seen.add(profile.path);
    return true;
  };

  await add("POS.md", "root-context", Math.min(maxChars, 12000));
  if (options.area) {
    const area = safeComponent(String(options.area), "Area");
    await add(`20_Areas/${area}/CONTEXT.md`, "selected-area-context", 12000);
  }
  if (options.project) {
    const project = safeComponent(String(options.project), "Project");
    await add(`10_Projects/${project}/CONTEXT.md`, "selected-project-context", 12000);
  }
  if (options.hostId) {
    const hostId = resolveHostId(options.hostId, {});
    await add(`99_AI/hosts/${hostId}/CONTEXT.md`, "selected-host-context", 8000);
  }
  if (options.roleId ?? options.agentId) {
    const roleId = resolveRoleId(options.roleId ?? options.agentId);
    await addTrustedRole(roleId);
  }

  const { records } = await ensureIndex(root);
  const selected = searchIndex(records, query, {
    area: options.area,
    project: options.project,
    limit: maxFiles,
  });
  let retrieved = 0;
  for (const candidate of selected) {
    if (retrieved >= maxFiles || usedChars >= maxChars) break;
    const added = await add(candidate.record.path, `search:${candidate.reasons.join(",")}`);
    if (added) retrieved += 1;
  }

  if (!bundle.length) throw new PosError("NO_CONTEXT", "No readable context was found.", null, 4);
  return {
    schema: "pos.context.v1",
    query,
    area: options.area ?? null,
    project: options.project ?? null,
    hostId: options.hostId ? resolveHostId(options.hostId, {}) : null,
    roleId: (options.roleId ?? options.agentId) ? resolveRoleId(options.roleId ?? options.agentId) : null,
    limits: { maxFiles, maxChars },
    retrievalGap: retrieved === 0,
    gapReason: retrieved === 0 ? "No relevant durable asset matched the query; only explicit Context files were loaded." : null,
    totals: {
      files: bundle.length,
      retrievedAssets: retrieved,
      characters: usedChars,
      estimatedTokens: bundle.reduce((total, item) => total + item.estimatedTokens, 0),
    },
    context: bundle,
  };
}
