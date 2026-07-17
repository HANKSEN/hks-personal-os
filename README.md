# Hks Personal OS

[简体中文](README.zh-CN.md) | English

Personal OS is a local-first file protocol, Codex/Claude skill, and zero-dependency Node.js CLI for routing personal knowledge work into the right context and applying AI-proposed changes safely.

> [!WARNING]
> Before authorizing any Agent to access valuable files, create a complete independent backup or snapshot and verify that it can be restored. Changesets, Undo history, Git, and cloud version history are not substitutes for a backup. The installer installs software only; it does not back up personal data. Read [the safety and disclaimer guide](docs/safety.en.md).

The responsibility boundary is deliberate: the Codex/Claude Skill understands natural language and decides how to route a task; the `pos` CLI performs deterministic filesystem, context, Changeset, audit, and recovery operations. The CLI itself does not invoke a model or infer intent.

It combines:

- PARA for physical ownership (`Projects`, `Areas`, `Resources`, `Archive`).
- `Knowledge`, `Experience`, `Principles`, `Artifacts`, and `Data` for durable asset meaning.
- Layered context retrieval instead of full-vault loading.
- Task-scoped AI workspaces and Changesets instead of uncontrolled writes.
- Reversible local history and an append-only audit trail.

## Lowest-friction installation

Give the GitHub repository URL to an Agent and ask it to read [AGENT_INSTALL.md](AGENT_INSTALL.md), preview every destination, request confirmation, install, and verify without initializing or reading a personal data root.

Or run one command:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --yes
```

Use `--agent codex`, `--agent claude`, or `--agent none --skill-dir <documented-parent>` for an explicit host. Unknown products never receive a guessed Skill path.

## Local-source installation

```bash
cd /absolute/path/to/personal-os
./install.sh --agent auto --dry-run
./install.sh --agent auto --yes
pos help
```

## Quick start

```bash
pos init /absolute/path/to/a-new-personal-os --areas "学习,工作"
```

`collaborative` is the default permission mode: AI may draft freely in `99_AI/`, while every formal write requires a previewed Changeset and `--yes`. `safe` and `trusted` are advanced modes; start with the default unless you have a specific policy requirement.

Version 1 initializes only a new or empty directory. It does not import, reorganize, test against, or take over an existing non-empty knowledge system.

Next:

- [Install the CLI and Agent Skill](docs/install.en.md)
- [Read backup, safety, and disclaimer guidance](docs/safety.en.md)
- [Complete the 15-minute first run](docs/first-run.md)
- Read [SKILL.md](SKILL.md) for the agent workflow

Internal product specifications, technical design documents, implementation planning, and private acceptance records are not included in the public distribution repository.
