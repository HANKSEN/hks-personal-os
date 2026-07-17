import path from "node:path";

import { PosError, invariant } from "./errors.mjs";
import { readJson } from "./io.mjs";
import { matchesAny, matchesAnyPathIdentity, normalizeRelative, pathIdentity } from "./safe-path.mjs";

export async function loadPolicy(root) {
  const policy = await readJson(path.join(root, ".pos", "policy.json"));
  invariant(policy?.schema === "pos.policy.v1", "INVALID_POLICY", "Unsupported Personal OS policy schema.", { schema: policy?.schema }, 3);
  invariant(["safe", "collaborative", "trusted"].includes(policy.mode), "INVALID_POLICY", "Unknown permission mode.", { mode: policy.mode }, 3);
  return policy;
}

export function canRead(policy, relative) {
  return !matchesAny(normalizeRelative(relative), policy.denyRead ?? []);
}

export function ignoredByIndex(policy, relative) {
  const normalized = normalizeRelative(relative);
  return matchesAny(normalized, [...(policy.ignoreIndex ?? []), ...(policy.denyRead ?? [])]);
}

export function isProtected(policy, relative) {
  return matchesAnyPathIdentity(normalizeRelative(relative), policy.protected ?? []);
}

export function isAutoWrite(policy, relative) {
  return matchesAny(normalizeRelative(relative), policy.autoWrite ?? []);
}

export function isWriteAllowed(policy, relative) {
  const normalized = normalizeRelative(relative);
  const identity = pathIdentity(normalized);
  if (identity === ".pos/project.json" || identity === ".pos/policy.json" || identity === ".git" || identity.startsWith(".git/")) return false;
  return matchesAny(normalized, policy.allowWrite ?? []);
}

export function assertWritePolicy(policy, relative, { approved = false, approveProtected = false } = {}) {
  const normalized = normalizeRelative(relative);
  if (!isWriteAllowed(policy, normalized)) {
    throw new PosError("WRITE_NOT_ALLOWED", "Policy does not allow writing this path.", { path: normalized }, 3);
  }
  if (policy.mode === "safe" && !isAutoWrite(policy, normalized)) {
    throw new PosError("SAFE_MODE_REFUSAL", "Safe mode permits writes only inside the AI workspace.", { path: normalized }, 3);
  }
  if (!approved && !isAutoWrite(policy, normalized)) {
    throw new PosError("APPROVAL_REQUIRED", "Formal writes require explicit approval.", { path: normalized }, 7);
  }
  if (isProtected(policy, normalized) && !approveProtected) {
    throw new PosError("PROTECTED_APPROVAL_REQUIRED", "Protected Context changes require explicit approval.", { path: normalized }, 7);
  }
}
