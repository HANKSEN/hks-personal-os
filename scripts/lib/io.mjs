import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  lstat,
  link,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { PosError } from "./errors.mjs";

export async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function lstatMaybe(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureDir(target) {
  await mkdir(target, { recursive: true });
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256Data(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

export async function hashPath(target) {
  const info = await lstatMaybe(target);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    throw new PosError("SYMLINK_REJECTED", "Symbolic links are not valid Personal OS assets.", { path: target }, 3);
  }
  if (info.isFile()) return `file:${await sha256File(target)}`;
  if (!info.isDirectory()) return `other:${info.mode}:${info.size}`;

  const hash = createHash("sha256");
  const visit = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const item = await lstat(absolute);
      if (item.isSymbolicLink()) {
        throw new PosError("SYMLINK_REJECTED", "Symbolic links are not valid Personal OS assets.", { path: absolute }, 3);
      }
      hash.update(`${rel}\0${item.mode}\0${item.size}\0`);
      if (item.isDirectory()) await visit(absolute, rel);
      else if (item.isFile()) hash.update(await readFile(absolute));
    }
  };
  await visit(target);
  return `dir:${hash.digest("hex")}`;
}

export async function atomicWrite(target, content) {
  await ensureDir(path.dirname(target));
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.pos-tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function atomicCreate(target, content) {
  await ensureDir(path.dirname(target));
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.pos-create-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, target);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new PosError("TARGET_EXISTS", "Create target appeared before the atomic commit.", { path: target }, 4);
    }
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

export async function atomicCopyCreate(source, target) {
  await ensureDir(path.dirname(target));
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.pos-copy-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await copyFile(source, temp, 1);
    const handle = await open(temp, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temp, target);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new PosError("TARGET_EXISTS", "Create target appeared before the atomic commit.", { path: target }, 4);
      }
      throw error;
    }
  } finally {
    await rm(temp, { force: true });
  }
}

export async function writeJsonAtomic(target, value) {
  await atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PosError("INVALID_JSON", "Invalid JSON file.", { path: target, message: error.message }, 2);
    }
    throw error;
  }
}

export async function appendJsonl(target, value) {
  await ensureDir(path.dirname(target));
  const handle = await open(target, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readTextBounded(target, maxBytes = 1024 * 1024) {
  const info = await stat(target);
  if (info.size > maxBytes) {
    const handle = await open(target, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return { text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: true, size: info.size };
    } finally {
      await handle.close();
    }
  }
  return { text: await readFile(target, "utf8"), truncated: false, size: info.size };
}

export async function copyPath(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    throw new PosError("SYMLINK_REJECTED", "Refusing to copy a symbolic link.", { path: source }, 3);
  }
  if (info.isDirectory()) {
    await ensureDir(destination);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyPath(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (!info.isFile()) {
    throw new PosError("UNSUPPORTED_FILE_TYPE", "Only regular files and directories can be copied.", { path: source }, 3);
  }
  await ensureDir(path.dirname(destination));
  await copyFile(source, destination);
}

export async function removePath(target) {
  await rm(target, { recursive: true, force: true });
}

export async function readJsonl(target) {
  if (!(await exists(target))) return [];
  const text = await readFile(target, "utf8");
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new PosError("INVALID_JSONL", "Invalid JSONL record.", { path: target, line: index + 1 }, 2);
      }
    });
}

export function isoNow() {
  return new Date().toISOString();
}

export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
