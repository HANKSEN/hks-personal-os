import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const MCP_SERVER_NAME = "hks-personal-os";

async function executable(target) {
  if (!target) return false;
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findCommand(name, env) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const entry of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${name}${extension}`);
      if (await executable(candidate)) return candidate;
    }
  }
  return null;
}

async function run(command, args, { home, cwd, env }) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: { ...env, HOME: home },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? ""),
      code: Number.isInteger(error?.code) ? error.code : 1,
    };
  }
}

function missingMessage(result) {
  return /(?:no mcp server|not found|does not exist|unknown server)/iu.test(`${result.stdout}\n${result.stderr}`);
}

function describesExpected(result, serverScript) {
  const text = `${result.stdout}\n${result.stderr}`;
  return text.includes(serverScript) && text.includes(process.execPath);
}

async function inspectRegistration(host, command, serverScript, environment) {
  const args = host === "codex"
    ? ["mcp", "get", MCP_SERVER_NAME, "--json"]
    : ["mcp", "get", MCP_SERVER_NAME];
  const result = await run(command, args, environment);
  if (!result.ok && missingMessage(result)) return { action: "create", current: null };
  if (!result.ok) return { action: "unsupported", reason: "host-mcp-inspection-failed", details: result.stderr.trim() };
  if (describesExpected(result, serverScript)) return { action: "reuse", current: result.stdout.trim() };
  return { action: "collision", reason: "existing-unmanaged-server", current: result.stdout.trim() };
}

function selectedSkill(skills, host) {
  return skills.find((item) => item.name === host);
}

export async function planHostIntegrations({
  home,
  cwd,
  env = process.env,
  skills,
  enabled = true,
  hostCommands = null,
} = {}) {
  const integrations = [];
  for (const host of ["codex", "claude"]) {
    const skill = selectedSkill(skills, host);
    if (!skill) continue;
    const serverScript = path.join(skill.path, "scripts", "mcp-server.mjs");
    if (!enabled) {
      integrations.push({ host, name: MCP_SERVER_NAME, action: "skipped", reason: "user-disabled", serverScript });
      continue;
    }
    const command = hostCommands && Object.hasOwn(hostCommands, host)
      ? hostCommands[host]
      : await findCommand(host, env);
    if (!command) {
      integrations.push({ host, name: MCP_SERVER_NAME, action: "unsupported", reason: "host-cli-not-found", serverScript });
      continue;
    }
    const inspected = await inspectRegistration(host, command, serverScript, { home, cwd, env });
    integrations.push({
      host,
      name: MCP_SERVER_NAME,
      command,
      serverCommand: process.execPath,
      serverArgs: [serverScript],
      serverScript,
      defaultEnabled: true,
      interaction: "mcp-form-elicitation-with-text-fallback",
      ...inspected,
    });
  }
  return integrations;
}

export async function applyHostIntegrations(integrations, { home, cwd, env = process.env } = {}) {
  const results = [];
  for (const item of integrations) {
    if (item.action !== "create") {
      results.push({ ...item, enabled: item.action === "reuse" });
      continue;
    }
    const args = item.host === "codex"
      ? ["mcp", "add", item.name, "--", item.serverCommand, ...item.serverArgs]
      : ["mcp", "add", "--scope", "user", item.name, "--", item.serverCommand, ...item.serverArgs];
    const result = await run(item.command, args, { home, cwd, env });
    results.push({
      ...item,
      enabled: result.ok,
      action: result.ok ? "enabled" : "failed",
      details: result.ok ? null : (result.stderr || result.stdout).trim(),
    });
  }
  return results;
}

export function interactiveApprovalSummary(integrations) {
  const enabled = integrations.filter((item) => ["enabled", "reuse"].includes(item.action) || item.enabled === true).map((item) => item.host);
  const available = integrations.filter((item) => ["create", "reuse", "enabled"].includes(item.action)).map((item) => item.host);
  return {
    schema: "personal-os.interactive-approval.v1",
    defaultEnabled: !integrations.some((item) => item.reason === "user-disabled"),
    enabled,
    available,
    fallback: "explicit-text-confirmation",
    integrations,
  };
}
