---
type: ai-workspace-context
status: active
---

# AI Workspace

## Purpose

`99_AI` stores isolated, temporary Agent work. It is not a formal knowledge or output library.

## Ownership

- Physical ownership is the actual Agent host, such as Codex or Claude Code.
- Task roles such as creator, researcher, builder, and reviewer are metadata loaded from the installed Skill.
- Each Run belongs to one host. Another host should create a new Run and reference a handoff instead of editing the first host's Run.

## Lifecycle

- Drafts, generated files, task logs, and proposals stay inside their Run.
- Approved durable results move through a Changeset into Projects, Areas, Resources, or Archive.
- Keep task-level summaries and errors; do not save private chain-of-thought, secrets, or full host telemetry by default.
- `shared/handoffs` is for explicit cross-host transfers. `trash` is the shared soft-delete destination used by Changesets.
