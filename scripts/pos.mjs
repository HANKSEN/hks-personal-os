#!/usr/bin/env node

import { applyChangeset, publicPlan, undoTask } from "./lib/changeset.mjs";
import { retrieveContext } from "./lib/context.mjs";
import { diagnose } from "./lib/doctor.mjs";
import { errorPayload, PosError } from "./lib/errors.mjs";
import { buildIndex } from "./lib/indexer.mjs";
import { initializeRoot } from "./lib/root.mjs";
import { createRun } from "./lib/runs.mjs";

const HELP = `Personal OS CLI

Usage:
  pos init <root> [--areas "Area A,Area B"] [--mode safe|collaborative|trusted]
  pos index <root>
  pos context <root> [--query "..."] [--area "..."] [--project "..."] [--max-files 8] [--max-chars 48000]
  pos run <root> --goal "..." [--agent orchestrator] [--intent create] [--area "..."] [--project "..."] [--write-scope "pattern,pattern"]
  pos apply <root> <changeset> [--yes] [--approve-protected]
  pos undo <root> <task-id> --yes [--force]
  pos doctor <root>
  pos help

All roots must be explicit. No command searches parent directories. Previewing apply has no formal-file side effects.`;

const HELP_RESULT = {
  schema: "pos.help.v1",
  usage: "pos <command> [arguments] [options]",
  commands: ["init", "index", "context", "run", "apply", "undo", "doctor", "help"],
  text: HELP,
};

const BOOLEAN_OPTIONS = new Set(["yes", "approveProtected", "force", "json", "rebuild"]);

function parse(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (BOOLEAN_OPTIONS.has(key)) {
      if (next === "true" || next === "false") {
        options[key] = next === "true";
        index += 1;
      } else {
        options[key] = true;
      }
    } else if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      throw new PosError("OPTION_VALUE_REQUIRED", `Option --${item.slice(2)} requires a value.`, { option: item }, 2);
    }
  }
  return { positional, options };
}

function csv(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function numberOption(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new PosError("INVALID_NUMBER", "Expected a positive numeric option.", { value }, 2);
  return number;
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const { positional, options } = parse(rest);
  let result;
  if (command === "help" || command === "--help" || command === "-h") {
    if (!options.json) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    result = HELP_RESULT;
  } else if (command === "init") {
    result = await initializeRoot(positional[0], { areas: csv(options.areas), mode: options.mode ?? "collaborative" });
  } else if (command === "index") {
    const indexed = await buildIndex(positional[0], { write: true, rebuild: Boolean(options.rebuild) });
    result = { root: indexed.root, meta: indexed.meta };
  } else if (command === "context") {
    result = await retrieveContext(positional[0], {
      query: options.query ?? "",
      area: options.area,
      project: options.project,
      maxFiles: numberOption(options.maxFiles, undefined),
      maxChars: numberOption(options.maxChars, undefined),
    });
  } else if (command === "run") {
    if (!options.goal) throw new PosError("GOAL_REQUIRED", "Run requires --goal.", undefined, 2);
    result = await createRun(positional[0], {
      goal: options.goal,
      request: options.request,
      query: options.query,
      intent: options.intent,
      agentId: options.agent,
      deliverable: options.deliverable,
      area: options.area,
      project: options.project,
      persistence: options.persistence,
      risk: options.risk,
      writeScope: csv(options.writeScope),
      maxFiles: numberOption(options.maxFiles, undefined),
      maxChars: numberOption(options.maxChars, undefined),
    });
  } else if (command === "apply") {
    result = await applyChangeset(positional[0], positional[1], {
      yes: options.yes === true,
      approveProtected: options.approveProtected === true,
    });
  } else if (command === "undo") {
    result = await undoTask(positional[0], positional[1], { yes: options.yes === true, force: options.force === true });
  } else if (command === "doctor") {
    result = await diagnose(positional[0]);
    if (!result.healthy) process.exitCode = 6;
  } else {
    throw new PosError("UNKNOWN_COMMAND", "Unknown command.", { command }, 2);
  }

  process.stdout.write(`${JSON.stringify({ ok: true, command, result }, null, options.json ? 0 : 2)}\n`);
}

main().catch((error) => {
  const payload = errorPayload(error);
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = error instanceof PosError ? error.exitCode : 5;
});
