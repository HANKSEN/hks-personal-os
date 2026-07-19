# Multi-Agent workspaces and legacy-root upgrade

[简体中文](ai-workspaces.md) | English

`99_AI` is temporary execution space, not a durable knowledge library. Physical directories are owned by the Agent host that actually executed a task, while research, creation, building, and review remain task Roles.

## Host, Role, and Run

| Concept | Examples | Purpose |
|---|---|---|
| Host | `codex`, `claude-code`, `workbuddy` | The actual Agent product and physical workspace owner |
| Role | `research`, `creator`, `builder`, `reviewer` | The capability profile selected for one task; it does not own a user-data directory |
| Run | one task ID | Contains that task's context, drafts, proposals, logs, and result |

```text
99_AI/
├── CONTEXT.md
├── hosts/
│   ├── codex/CONTEXT.md
│   ├── codex/runs/<run-id>/{work,proposed,logs,...}
│   ├── claude-code/CONTEXT.md
│   └── claude-code/runs/<run-id>/{work,proposed,logs,...}
├── shared/handoffs/
└── trash/
```

Role Profiles remain in the installed Skill under `assets/roles/`. The Personal OS data root no longer copies logical `builder / creator / reviewer` Agent folders.

## Operating rules

1. The invoking Agent should pass its stable host ID. Use `generic` when unavailable; never infer a host from personal content.
2. Drafts, generated files, task-level action summaries, and errors stay inside the current Run. Do not log secrets, private reasoning, or full provider telemetry.
3. A Run belongs to one Host. A different Host creates a new Run and uses an explicit `shared/handoffs/` summary instead of editing the first Host's Run.
4. Durable results move through a previewed and approved Changeset into a Project, Area, Resource, or Archive. All `99_AI` content is excluded from the durable index.
5. `trash/`, `.pos` transactions, and the Apply lock remain shared safety controls.

```bash
pos run <root> --goal "finish an article" --host codex --role creator
pos run <root> --goal "review article metrics" --host claude-code --role reviewer
```

The global CLI remains optional; an Agent can invoke `scripts/pos.mjs` inside the installed Skill package.

## Upgrade an existing data root

Software update and Personal OS data-root upgrade are separate permissions. Updating the Skill does not discover or modify data roots. After the user explicitly selects an initialized root:

```bash
# Preview only
pos workspace-upgrade <root>

# Apply only after reviewing every move and policy change
pos workspace-upgrade <root> --yes
```

The upgrade conservatively maps unknown history:

- `99_AI/runs` → `99_AI/hosts/legacy/runs`
- `99_AI/agents` → `99_AI/shared/legacy-roles`
- `99_AI/proposed` → `99_AI/shared/legacy-proposed`

It never guesses which host created a historical Run. Conflicting targets stop the upgrade; a mid-transaction failure restores moved directories, policy, and the layout marker. Create and restore-test an independent full backup first.

Afterward, run `pos doctor <root>` and create one test Run from each commonly used Host to verify isolation, Changeset preview, and Undo.
