# Compatibility

The file protocol uses Markdown, JSON, and JSONL and is independent of a specific note application.

The CLI targets Node.js 20 or later and does not require a database or external npm dependency. The v1 validation evidence in this repository was produced on macOS; Linux and Windows should be treated as portability targets until their CI matrices are added.

The Skill is designed for Codex and Claude Code style local agents. Install it in `~/.codex/skills/personal-os` or `~/.claude/skills/personal-os`; product-specific plugin manifests are adapters, while `SKILL.md` and the installed `pos` CLI remain the source of truth.

The installer also supports the shared `~/.agents/skills/personal-os` location and an explicit `--skill-dir` for WorkBuddy, QCode, Kimi, or other hosts. The shared location is an interoperability option, not a guarantee that every host discovers it. Undocumented product paths are never guessed.

The host agent must support reading the Skill and invoking local commands. Natural-language clarification and routing occur in that host model. The CLI is model-independent and does not make network or LLM calls.

Git is optional. Personal OS also keeps task-scoped rollback snapshots under `.pos/history/` so a formal change remains reversible without Git.

Version 1 is a greenfield initializer, not an importer or migration tool. It deliberately refuses an existing non-empty target on every supported platform.
