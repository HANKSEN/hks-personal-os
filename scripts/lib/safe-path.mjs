import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { PosError, invariant } from "./errors.mjs";
import { lstatMaybe } from "./io.mjs";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/u;

export function normalizeRelative(input, { allowEmpty = false } = {}) {
  invariant(typeof input === "string", "INVALID_PATH", "Path must be a string.", { input }, 3);
  invariant(!CONTROL_CHARACTERS.test(input), "INVALID_PATH", "Path contains control characters.", { input }, 3);
  invariant(!path.posix.isAbsolute(input) && !path.win32.isAbsolute(input) && !WINDOWS_ABSOLUTE.test(input), "ABSOLUTE_PATH_REJECTED", "Absolute paths are not allowed.", { input }, 3);

  const posix = input.replaceAll("\\", "/");
  const parts = posix.split("/");
  invariant(!parts.includes(".."), "PATH_TRAVERSAL_REJECTED", "Parent traversal is not allowed.", { input }, 3);
  const normalized = path.posix.normalize(posix).replace(/^\.\//u, "");
  invariant(allowEmpty || (normalized !== "." && normalized !== ""), "INVALID_PATH", "Path cannot be empty.", { input }, 3);
  invariant(normalized !== ".." && !normalized.startsWith("../"), "PATH_TRAVERSAL_REJECTED", "Parent traversal is not allowed.", { input }, 3);
  return normalized === "." ? "" : normalized;
}

export function resolveInside(root, relative) {
  const normalized = normalizeRelative(relative, { allowEmpty: true });
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/").filter(Boolean));
  const prefix = `${resolvedRoot}${path.sep}`;
  invariant(resolved === resolvedRoot || resolved.startsWith(prefix), "PATH_OUTSIDE_ROOT", "Path resolves outside the Personal OS root.", { relative }, 3);
  return resolved;
}

export async function assertRootNotSymlink(root) {
  const info = await lstat(root);
  invariant(!info.isSymbolicLink(), "SYMLINK_ROOT_REJECTED", "The Personal OS root cannot be a symbolic link.", { root }, 3);
  invariant(info.isDirectory(), "INVALID_ROOT", "The Personal OS root must be a directory.", { root }, 3);
}

export async function assertNoSymlinkComponents(root, relative, { includeLeaf = true } = {}) {
  const normalized = normalizeRelative(relative, { allowEmpty: true });
  const parts = normalized.split("/").filter(Boolean);
  let current = path.resolve(root);
  const limit = includeLeaf ? parts.length : Math.max(0, parts.length - 1);
  for (let index = 0; index < limit; index += 1) {
    const component = parts[index];
    const entries = await readdir(current).catch((error) => {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
      throw error;
    });
    if (!entries) break;
    const exact = entries.includes(component);
    if (!exact) {
      const identity = component.normalize("NFKC").toLowerCase();
      const alias = entries.find((entry) => entry.normalize("NFKC").toLowerCase() === identity);
      if (alias && alias.normalize("NFC") !== component.normalize("NFC")) {
        throw new PosError("PATH_ALIAS_REJECTED", "Path spelling aliases an existing filesystem entry.", {
          requested: parts.slice(0, index).concat(component).join("/"),
          canonical: parts.slice(0, index).concat(alias).join("/"),
        }, 3);
      }
    }
    current = path.join(current, component);
    const info = await lstatMaybe(current);
    if (!info) break;
    invariant(!info.isSymbolicLink(), "SYMLINK_REJECTED", "Path traverses a symbolic link.", { path: parts.slice(0, index + 1).join("/") }, 3);
  }
}

export function globToRegExp(pattern) {
  const normalized = normalizeRelative(pattern, { allowEmpty: true });
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  expression += "$";
  return new RegExp(expression, "u");
}

export function matchesAny(relative, patterns = []) {
  const normalized = normalizeRelative(relative, { allowEmpty: true });
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function pathIdentity(relative) {
  return normalizeRelative(relative, { allowEmpty: true }).normalize("NFKC").toLowerCase();
}

export function matchesAnyPathIdentity(relative, patterns = []) {
  const identity = pathIdentity(relative);
  return patterns.some((pattern) => globToRegExp(pathIdentity(pattern)).test(identity));
}

export async function walkSafe(root, options = {}) {
  const files = [];
  const symlinks = [];
  const start = path.resolve(root);
  const visit = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (options.skip?.(relative, entry)) continue;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        symlinks.push(relative);
        continue;
      }
      if (info.isDirectory()) await visit(absolute, relative);
      else if (info.isFile()) files.push({ relative, absolute, info });
    }
  };
  await visit(start);
  return { files, symlinks };
}

export function safeComponent(value, label = "name") {
  invariant(typeof value === "string" && value.trim().length > 0, "INVALID_COMPONENT", `${label} cannot be empty.`, { value }, 2);
  const trimmed = value.trim();
  invariant(!trimmed.includes("/") && !trimmed.includes("\\") && trimmed !== "." && trimmed !== "..", "INVALID_COMPONENT", `${label} must be a single path component.`, { value }, 2);
  invariant(!CONTROL_CHARACTERS.test(trimmed), "INVALID_COMPONENT", `${label} contains control characters.`, { value }, 2);
  return trimmed;
}
