import { access } from "node:fs/promises";
import path from "node:path";

const SHARED_SKILL_PARENT = [".agents", "skills"];

const definitions = [
  {
    id: "generic",
    aliases: ["agents", "agent-skills", "agentskills"],
    label: "Agents Skills",
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[".agents"]],
    detectionCommands: [],
    support: "verified-standard",
    activation: "filesystem-skill",
    evidence: "https://agentskills.io",
  },
  {
    id: "codex",
    aliases: ["openai-codex"],
    label: "Codex",
    skillParent: [".codex", "skills"],
    detectionDirectories: [[".codex"]],
    detectionCommands: ["codex"],
    support: "verified-native",
    activation: "filesystem-skill-and-mcp",
    evidence: "https://developers.openai.com/codex/skills",
  },
  {
    id: "claude",
    aliases: ["claude-code", "claudecode"],
    label: "Claude Code",
    skillParent: [".claude", "skills"],
    detectionDirectories: [[".claude"]],
    detectionCommands: ["claude"],
    support: "verified-native",
    activation: "filesystem-skill-and-mcp",
    evidence: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "openclaw",
    aliases: ["open-claw"],
    label: "OpenClaw",
    skillParent: [".openclaw", "skills"],
    detectionDirectories: [[".openclaw"]],
    detectionCommands: ["openclaw"],
    support: "verified-native",
    activation: "filesystem-skill",
    evidence: "https://docs.openclaw.ai/tools/skills",
  },
  {
    id: "hermes",
    aliases: ["hermes-agent"],
    label: "Hermes Agent",
    skillParent: [".hermes", "skills"],
    detectionDirectories: [[".hermes"]],
    detectionCommands: ["hermes"],
    support: "verified-native",
    activation: "filesystem-skill",
    evidence: "https://hermes-agent.nousresearch.com/docs/user-guide/features/skills",
  },
  {
    id: "workbuddy",
    aliases: ["work-buddy"],
    label: "WorkBuddy",
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[".workbuddy"]],
    detectionCommands: ["workbuddy"],
    support: "verified-plugin-compatible",
    activation: "plugin-bundle-with-shared-skill-fallback",
    pluginManifest: ".workbuddy-plugin/plugin.json",
    evidence: "https://www.codebuddy.cn/docs/cli/plugins-reference",
  },
  {
    id: "codebuddy",
    aliases: ["code-buddy", "tencent-codebuddy"],
    label: "CodeBuddy",
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[".codebuddy"]],
    detectionCommands: ["codebuddy"],
    support: "verified-plugin-compatible",
    activation: "plugin-bundle-with-shared-skill-fallback",
    pluginManifest: ".codebuddy-plugin/plugin.json",
    evidence: "https://www.codebuddy.cn/docs/cli/plugins-reference",
  },
  {
    id: "trae",
    aliases: ["trae-ide"],
    label: "TRAE",
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[".trae"]],
    detectionCommands: ["trae"],
    support: "standard-fallback",
    activation: "shared-skill-or-explicit-plugin-import",
    evidence: "https://docs.trae.ai/ide/skills",
  },
  {
    id: "trae-solo",
    aliases: ["trae_solo", "traesolo", "solo"],
    label: "TRAE SOLO",
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[".trae-solo"]],
    detectionCommands: ["trae-solo"],
    support: "standard-fallback",
    activation: "shared-skill-or-explicit-plugin-import",
    evidence: "https://docs.trae.ai/ide/skills",
  },
  ...[
    ["kimi", ["kimi-cli"], "Kimi Agent"],
    ["qcode", ["q-code"], "QCode"],
    ["qoder", [], "Qoder"],
    ["cursor", [], "Cursor"],
    ["windsurf", [], "Windsurf"],
    ["cline", [], "Cline"],
    ["roo-code", ["roo"], "Roo Code"],
    ["opencode", ["open-code"], "OpenCode"],
    ["gemini-cli", ["gemini"], "Gemini CLI"],
  ].map(([id, aliases, label]) => ({
    id,
    aliases,
    label,
    skillParent: SHARED_SKILL_PARENT,
    detectionDirectories: [[`.${id}`]],
    detectionCommands: [id],
    support: "standard-fallback",
    activation: "shared-skill-or-explicit-path",
    evidence: "https://agentskills.io",
  })),
];

const byId = new Map(definitions.map((item) => [item.id, item]));
const aliases = new Map(definitions.flatMap((item) => [
  [item.id, item.id],
  ...item.aliases.map((alias) => [alias, item.id]),
]));

export const ALL_AGENT_TARGETS = definitions.map((item) => item.id);

export function normalizeAgentId(value) {
  return aliases.get(String(value ?? "").trim().toLowerCase()) ?? null;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findCommand(names, env) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of names) {
    for (const entry of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
      for (const extension of extensions) {
        if (await exists(path.join(entry, `${name}${extension}`))) return name;
      }
    }
  }
  return null;
}

export async function detectAgentHosts({ home, env = process.env } = {}) {
  const detected = {};
  for (const definition of definitions) {
    const directory = await Promise.any(
      definition.detectionDirectories.map(async (parts) => {
        const candidate = path.join(home, ...parts);
        if (await exists(candidate)) return candidate;
        throw new Error("not-found");
      }),
    ).catch(() => null);
    const command = await findCommand(definition.detectionCommands, env);
    detected[definition.id] = {
      detected: Boolean(directory || command),
      directory,
      command,
      signals: [directory ? "config-directory" : null, command ? "host-command" : null].filter(Boolean),
    };
  }
  return detected;
}

function targetParent(definition, home) {
  return path.join(home, ...definition.skillParent);
}

export function resolveAgentSelection({
  agentOption = "auto",
  home,
  customParents = [],
  detected = {},
} = {}) {
  const raw = String(agentOption ?? "auto").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const requested = raw.length ? raw : ["auto"];
  const validControl = new Set(["auto", "all", "none"]);
  const unknown = requested.filter((item) => !validControl.has(item) && !normalizeAgentId(item));
  if (unknown.length) {
    const error = new Error(`Unknown Agent target: ${unknown.join(", ")}`);
    error.code = "UNKNOWN_AGENT_TARGET";
    error.details = { unknown, allowed: ["auto", "all", "none", ...ALL_AGENT_TARGETS] };
    throw error;
  }

  const selected = new Set();
  if (requested.includes("all")) {
    for (const id of ALL_AGENT_TARGETS) selected.add(id);
  } else if (requested.includes("auto")) {
    selected.add("generic");
    for (const definition of definitions) {
      if (definition.id !== "generic" && detected[definition.id]?.detected) selected.add(definition.id);
    }
  }
  for (const item of requested) {
    const normalized = normalizeAgentId(item);
    if (normalized) selected.add(normalized);
  }
  if (requested.includes("none")) selected.clear();

  const targets = new Map();
  const addTarget = (definition, parent, discovery) => {
    const resolved = path.resolve(parent);
    const current = targets.get(resolved) ?? {
      name: definition.id,
      hosts: [],
      parent: resolved,
      discovery,
      support: definition.support,
      evidence: [],
    };
    current.hosts = [...new Set([...current.hosts, definition.id])];
    current.evidence = [...new Set([...current.evidence, definition.evidence])];
    if (current.hosts.length > 1 && resolved === path.resolve(home, ...SHARED_SKILL_PARENT)) current.name = "generic";
    targets.set(resolved, current);
  };

  for (const id of selected) {
    const definition = byId.get(id);
    addTarget(definition, targetParent(definition, home), definition.id === "generic" ? "agents-skills-standard" : definition.activation);
  }
  for (const parent of customParents) {
    const resolved = path.resolve(parent);
    targets.set(resolved, {
      name: "custom",
      hosts: ["custom"],
      parent: resolved,
      discovery: "explicit-host-path",
      support: "user-specified",
      evidence: [],
    });
  }

  const adapters = [...selected].map((id) => {
    const definition = byId.get(id);
    return {
      host: id,
      label: definition.label,
      detected: Boolean(detected[id]?.detected),
      signals: detected[id]?.signals ?? [],
      support: definition.support,
      activation: definition.activation,
      skillParent: targetParent(definition, home),
      pluginManifest: definition.pluginManifest ?? null,
      evidence: definition.evidence,
    };
  });
  return { requested, selected: [...selected], targets: [...targets.values()], adapters };
}

export function hostRegistry() {
  return definitions.map((item) => ({
    id: item.id,
    aliases: item.aliases,
    label: item.label,
    support: item.support,
    activation: item.activation,
    skillParent: item.skillParent.join("/"),
    pluginManifest: item.pluginManifest ?? null,
    evidence: item.evidence,
  }));
}
