# First use: start without learning the directory model

[简体中文](first-run.md) | English

This guide is for a new user. You do not need to learn PARA, Knowledge, or Changesets first; state what you want to accomplish.

## 1. Install and choose a new system

Give the repository URL to an Agent and ask it to follow `AGENT_SETUP.md`, or run:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup --agent auto
```

Choose “create a new Personal OS.” The Agent must show the exact root and whether it is missing, empty, initialized, or non-empty. Only confirm a missing or empty directory. Route an existing non-empty directory to the [existing-directory journey](existing-directory.en.md).

## 2. What initialization creates

- `START_HERE.md`: compact beginner guidance;
- `POS.md`: core personal context and collaboration boundaries;
- `00_Inbox`: untriaged inputs and intents;
- `10_Projects`: work with a finish condition;
- `20_Areas`: ongoing responsibilities and durable assets;
- `30_Resources`: classified external material not yet synthesized;
- `90_Archive`: inactive material;
- `99_AI/hosts/<host-id>/runs/<run-id>`: temporary work isolated by the Agent product that actually executes it;
- `99_AI/shared/handoffs`: explicit cross-Agent continuation summaries;
- `.pos`: index, policy, audit, history, and recovery state.

Areas and personalization are optional. It is often easier to create them from the first real task than to design a taxonomy in advance.

## 3. Use one real first task

Try one request:

```text
Use the personal-os Skill. Treat this long article as a new input.
Ask at most one necessary question to determine whether I want a temporary read,
long-term learning, or a creation input, then route and process it safely.
```

```text
Use the personal-os Skill. I want to accomplish ____, but I do not know where it belongs.
Frame the problem, retrieve only necessary context, draft in the AI workspace,
and show me the formal change before applying it.
```

The user does not need to choose an asset type first. The Skill clarifies the actual goal, selects an owner and task Role, records the actual Agent Host, works inside that Host's isolated Run, and previews formal changes.

## 4. Asset meaning at completion

| Asset | Meaning |
|---|---|
| Knowledge | A concept or model you now understand |
| Experience | A time-bound action, decision, result, or review |
| Principles | An evidence-backed reusable rule, method, or SOP |
| Artifacts | A completed or shipped article, video, code, Skill, or deliverable |
| Data | Checkable metrics, exports, measurements, or time series |

A published article is an Artifact; its reusable writing SOP is a Principle; a click-through experiment and review is Experience; platform exports are Data.

## 5. Completion check

A beginner is ready when they know that untriaged input starts through Inbox or natural language; Projects finish while Areas continue; each Agent drafts inside its own `99_AI/hosts/<host-id>/runs/` workspace; formal changes require preview and approval; Undo helps but never replaces an independent backup.
