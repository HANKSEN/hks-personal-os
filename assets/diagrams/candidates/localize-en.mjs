import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const outputDir = resolve(root, "localized/en");

const specs = [
  {
    source: "01-personal-os-core-loop.workflow.json",
    output: "01-personal-os-core-loop.workflow.json",
    meta: {
      title: "From one request to reusable assets",
      subtitle: "Hks Personal OS core loop · You state the goal; AI routes, collaborates, and proposes",
      output: "assets/diagrams/candidates/localized/en/01-personal-os-core-loop.html"
    },
    collections: {
      lanes: {
        intake: { label: "Single entry" },
        understand: { label: "Clarify + route" },
        workspace: { label: "Isolated Agent workspace" },
        governance: { label: "Human decision" },
        durable: { label: "Durable assets" }
      },
      phases: {
        capture: { label: "Capture first" },
        understanding: { label: "Clarify + retrieve" },
        collaboration: { label: "Draft, approve, preserve" }
      },
      groups: {
        route_loop: { label: "Minimum clarification" },
        run_space: { label: "AI temporary work" },
        approval_space: { label: "Protected write boundary" }
      },
      nodes: {
        intent: { label: "Input / files", sublabel: "goal, not folder" },
        inbox: { label: "00_Inbox", sublabel: "single entry", tag: "low friction" },
        router: { label: "Intent check", sublabel: "ask only if unclear" },
        context: { label: "Context", sublabel: "related assets", tag: "bounded context" },
        run: { label: "Isolated Run", sublabel: "work · proposed · logs", tag: "temporary" },
        proposal: { label: "Proposal", sublabel: "path + scope" },
        approval: { label: "Approval", sublabel: "accept · revise", tag: "final call" },
        assets: { label: "Assets", sublabel: "PARA + type", tag: "approved only" }
      }
    },
    edgeLabels: {
      "inbox->router": "real goal?",
      "context->run": "only what is needed",
      "approval->assets": "approved write",
      "approval->run": "not approved: revise",
      "assets->context": "reuse on demand"
    },
    cards: [
      { dot: "cyan", title: "Single entry", items: ["Say what you want or drop in a file", "No PARA or asset taxonomy required", "Ask only when routing information is missing"] },
      { dot: "rose", title: "Two guardrails", items: ["AI writes freely inside its own Run", "Durable writes arrive as a Changeset", "Human approval remains the final gate"] },
      { dot: "emerald", title: "Compounding output", items: ["Knowledge: what I understand", "Experience: what happened when I acted", "Principles: what should guide the next action", "Artifacts + Data: outputs and verifiable evidence"] }
    ]
  },
  {
    source: "02-personal-os-system-map.architecture.json",
    output: "02-personal-os-system-map.architecture.json",
    meta: {
      title: "One directory, two spaces",
      subtitle: "PARA owns durable assets; 99_AI isolates each Agent's temporary work",
      output: "assets/diagrams/candidates/localized/en/02-personal-os-system-map.html"
    },
    collections: {
      components: {
        pos: { label: "POS.md", sublabel: "global rules + personal context", tag: "always read" },
        inbox: { label: "00_Inbox", sublabel: "intent / file entry" },
        router: { label: "Intent router", sublabel: "goal · domain · lifecycle" },
        ai: { label: "99_AI / hosts", sublabel: "Codex · Claude · Kimi …", tag: "isolated runs" },
        para: { label: "PARA space", sublabel: "one owner after approval", tag: "durable" },
        projects: { label: "Projects", sublabel: "goal + completion criteria" },
        areas: { label: "Areas", sublabel: "ongoing responsibilities" },
        resources: { label: "Resources", sublabel: "external, not yet absorbed" },
        archive: { label: "Archive", sublabel: "inactive but traceable" },
        assets: { label: "Area asset types", sublabel: "K · E · P · A · D", tag: "optional" },
        handoffs: { label: "shared / handoffs", sublabel: "cross-Agent package" },
        control: { label: ".pos", sublabel: "index · policy · audit · undo" }
      },
      boundaries: {
        "AI 临时空间 · 可清理、可隔离": { label: "AI temporary space · isolated + disposable" },
        "正式资产空间 · 可复用、可追溯": { label: "Durable asset space · reusable + traceable" }
      }
    },
    connectionLabels: {
      "pos->router": "rules + prefs",
      "inbox->router": "one entry",
      "router->ai": "Host + Role + Run",
      "ai->para": "approved Changeset",
      "areas->assets": "optional split",
      "handoffs->ai": "explicit handoff",
      "control->router": "index + audit"
    },
    cards: [
      { dot: "cyan", title: "PARA owns location", items: ["Project: finite action", "Area: ongoing responsibility", "Resource: external reference", "Archive: inactive material"] },
      { dot: "rose", title: "99_AI owns process", items: ["Separate workspaces for Codex, Claude Code, and others", "Every Run keeps work, proposed changes, and logs", "Agents exchange work only through explicit handoffs"] },
      { dot: "emerald", title: "Asset types own meaning", items: ["K: Knowledge　E: Experience", "P: Principles　A: Artifacts", "D: Data; an Area does not need every type"] }
    ]
  },
  {
    source: "03-experience-compounding.workflow.json",
    output: "03-experience-compounding.workflow.json",
    meta: {
      title: "Experience upgrades the next action",
      subtitle: "Facts become reviews; reviews become candidate principles; evidence promotes them into stable SOPs",
      output: "assets/diagrams/candidates/localized/en/03-experience-compounding.html"
    },
    collections: {
      lanes: {
        evidence: { label: "Evidence + experience" },
        learning: { label: "Review + inference" },
        governance: { label: "Human validation" },
        reuse: { label: "Stable reuse" }
      },
      phases: {
        observe: { label: "Record facts" },
        learn: { label: "Review + extract" },
        compound: { label: "Next action" }
      },
      groups: {
        fact_base: { label: "Verifiable facts only" },
        promotion: { label: "Principle promotion gate" }
      },
      nodes: {
        data: { label: "Data", sublabel: "metrics · outcomes" },
        experience: { label: "Experience", sublabel: "time · action · result" },
        nextdata: { label: "New Data", sublabel: "feeds Experience" },
        review: { label: "Review", sublabel: "facts · inference · unknowns" },
        candidate: { label: "Candidate", sublabel: "not yet proven", tag: "not truth yet" },
        approval: { label: "Validate", sublabel: "evidence stable?" },
        keep: { label: "Keep", sublabel: "stay as Experience" },
        sop: { label: "Stable SOP", sublabel: "scope + limits", tag: "reusable" },
        action: { label: "Next Action", sublabel: "uses prior experience" }
      }
    },
    edgeLabels: {
      "experience->review": "start review",
      "approval->sop": "promote",
      "action->nextdata": "creates new facts"
    },
    cards: [
      { dot: "cyan", title: "Experience", items: ["What happened in a specific context?", "Always keep time, action, and result", "One event is not automatically a general rule"] },
      { dot: "rose", title: "Principle Candidate", items: ["AI may detect patterns but cannot declare truth", "Keep evidence, counterexamples, and scope", "Weak evidence stays in Experience"] },
      { dot: "emerald", title: "Where compounding happens", items: ["Stable principles enter the next task's context", "New outcomes keep correcting old principles", "The system compounds judgment, not file count"] }
    ]
  },
  {
    source: "04-safe-write.workflow.json",
    output: "04-safe-write.workflow.json",
    meta: {
      title: "Let AI collaborate boldly; commit carefully",
      subtitle: "Every change begins as a reviewable proposal, then a deterministic runtime applies and records it",
      output: "assets/diagrams/candidates/localized/en/04-safe-write.html"
    },
    collections: {
      lanes: {
        run: { label: "Agent Run" },
        runtime: { label: "Deterministic runtime" },
        human: { label: "Human approval" },
        commit: { label: "Formal write" },
        audit: { label: "Audit trail" },
        exception: { label: "Revise + undo" }
      },
      phases: {
        draft: { label: "Draft + target path" },
        verify: { label: "Validate, then preview" },
        decide: { label: "Human decides" },
        record: { label: "Write + record" }
      },
      groups: {
        proposal: { label: "AI temporary space" },
        deterministic: { label: "Repeatable checks" },
        approval_gate: { label: "Visible risk" },
        exception_path: { label: "Stop or recover" }
      },
      nodes: {
        draft: { label: "Draft", sublabel: "inside this Run" },
        changeset: { label: "CHANGESET.json", sublabel: "action · target · reason", tag: "proposal" },
        validate: { label: "Schema Check", sublabel: "bounds · conflicts" },
        preview: { label: "Diff Preview", sublabel: "impact first" },
        approval: { label: "Approval", sublabel: "accept · revise", tag: "final call" },
        apply: { label: "Apply", sublabel: "deterministic write" },
        audit: { label: "Audit + Undo", sublabel: "hashes + undo" },
        revise: { label: "Revise", sublabel: "no formal write" },
        rollback: { label: "Rollback", sublabel: "safe conflict stop" }
      }
    },
    edgeLabels: {
      "changeset->validate": "submit proposal",
      "preview->approval": "show impact",
      "approval->apply": "approved",
      "apply->audit": "record",
      "approval->revise": "reject or revise",
      "revise->draft": "back to Run; no formal write",
      "audit->rollback": "undo if needed"
    },
    cards: [
      { dot: "cyan", title: "Safe by default", items: ["AI writes directly only inside a Run", "No silent overwrite of durable assets", "Delete, overwrite, and out-of-bounds paths are denied"] },
      { dot: "rose", title: "Human-readable", items: ["Changeset explains what changes and why", "Diff exposes the real impact before approval", "Protected context requires explicit approval"] },
      { dot: "emerald", title: "Recoverable", items: ["Content hashes are recorded before and after Apply", "External edits trigger conflict protection", "Audit records and safe Undo remain available"] }
    ]
  }
];

function applyById(items = [], overrides = {}) {
  for (const item of items) {
    if (overrides[item.id]) Object.assign(item, overrides[item.id]);
  }
}

function applyByLabel(items = [], overrides = {}) {
  for (const item of items) {
    if (overrides[item.label]) Object.assign(item, overrides[item.label]);
  }
}

await mkdir(outputDir, { recursive: true });

for (const spec of specs) {
  const sourcePath = resolve(root, spec.source);
  const outputPath = resolve(outputDir, spec.output);
  const diagram = JSON.parse(await readFile(sourcePath, "utf8"));
  Object.assign(diagram.meta, spec.meta);

  for (const [name, overrides] of Object.entries(spec.collections ?? {})) {
    if (name === "boundaries") applyByLabel(diagram[name], overrides);
    else applyById(diagram[name], overrides);
  }

  for (const edge of diagram.edges ?? []) {
    const key = `${edge.from}->${edge.to}`;
    if (spec.edgeLabels?.[key]) edge.label = spec.edgeLabels[key];
  }

  for (const connection of diagram.connections ?? []) {
    const key = `${connection.from}->${connection.to}`;
    if (spec.connectionLabels?.[key]) connection.label = spec.connectionLabels[key];
  }

  diagram.cards = spec.cards;
  const serialized = `${JSON.stringify(diagram, null, 2)}\n`;
  if (/\p{Script=Han}/u.test(serialized)) {
    throw new Error(`English localization left CJK text in ${spec.output}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}
