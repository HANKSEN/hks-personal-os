import path from "node:path";

import { sha256Text } from "./io.mjs";

const FRONTMATTER_LIMIT = 64 * 1024;

function parseScalar(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value);
    } catch {
      return value
        .slice(1, -1)
        .split(",")
        .map((item) => parseScalar(item))
        .filter((item) => item !== null);
    }
  }
  return value;
}

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { data: {}, body: text, raw: "" };
  }
  const end = text.search(/\r?\n---\r?\n/u);
  if (end < 0 || end > FRONTMATTER_LIMIT) return { data: {}, body: text, raw: "" };
  const firstBreak = text.indexOf("\n");
  const raw = text.slice(firstBreak + 1, end);
  const delimiterLength = text.slice(end).startsWith("\r\n---\r\n") ? 7 : 5;
  const body = text.slice(end + delimiterLength);
  const data = {};
  let listKey = null;
  for (const line of raw.split(/\r?\n/u)) {
    if (/^\s*#/u.test(line) || !line.trim()) continue;
    const listMatch = line.match(/^\s*-\s+(.+)$/u);
    if (listMatch && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(parseScalar(listMatch[1]));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      listKey = null;
      continue;
    }
    const [, key, value] = match;
    data[key] = value.trim() ? parseScalar(value) : null;
    listKey = value.trim() ? null : key;
  }
  return { data, body, raw };
}

export function markdownInfo(text, relativePath) {
  const { data, body } = parseFrontmatter(text);
  const headings = [];
  let firstTitle = null;
  let inFence = false;
  const excerptLines = [];
  for (const line of body.split(/\r?\n/u)) {
    if (/^```/u.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (heading) {
      const label = heading[2].replace(/\s+#+$/u, "").trim();
      headings.push(label);
      if (!firstTitle && heading[1].length === 1) firstTitle = label;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("<!--") && excerptLines.join(" ").length < 600) {
      excerptLines.push(trimmed);
    }
  }
  const parts = relativePath.split("/");
  const areaIndex = parts.indexOf("20_Areas");
  const projectIndex = parts.indexOf("10_Projects");
  const title = String(data.title ?? firstTitle ?? path.basename(relativePath, path.extname(relativePath)));
  const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
  return {
    id,
    key: id ?? `path-${sha256Text(relativePath).slice(0, 20)}`,
    title,
    type: typeof data.type === "string" ? data.type.toLowerCase() : inferType(relativePath),
    status: typeof data.status === "string" ? data.status.toLowerCase() : "unknown",
    area: data.area ?? (areaIndex >= 0 ? parts[areaIndex + 1] ?? null : null),
    project: data.project ?? (projectIndex >= 0 ? parts[projectIndex + 1] ?? null : null),
    created: data.created ?? data.created_at ?? null,
    updated: data.updated ?? data.updated_at ?? null,
    tags: normalizeList(data.tags),
    related: normalizeList(data.related),
    headings: headings.slice(0, 40),
    excerpt: excerptLines.join(" ").slice(0, 600),
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function inferType(relativePath) {
  const parts = relativePath.toLowerCase().split("/");
  if (parts.includes("knowledge")) return "knowledge";
  if (parts.includes("experience")) return "experience";
  if (parts.includes("principles")) return "principle";
  if (parts.includes("artifacts")) return "artifact";
  if (parts.includes("data")) return "data";
  if (parts.includes("30_resources")) return "source";
  if (path.basename(relativePath).toLowerCase() === "context.md" || relativePath === "POS.md") return "context";
  return "note";
}

export function tokenize(value) {
  const lower = String(value ?? "").normalize("NFKC").toLowerCase();
  const tokens = new Set();
  for (const match of lower.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    tokens.add(word);
    if (/\p{Script=Han}/u.test(word)) {
      const chars = [...word];
      for (const char of chars) tokens.add(char);
      for (let index = 0; index < chars.length - 1; index += 1) tokens.add(`${chars[index]}${chars[index + 1]}`);
    }
  }
  return [...tokens].filter(Boolean);
}
