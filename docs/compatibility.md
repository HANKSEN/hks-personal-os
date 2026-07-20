# Compatibility

The file protocol uses Markdown, JSON, and JSONL and is independent of a specific note application.

The embedded deterministic runtime targets Node.js 20 or later and does not require a database or external npm dependency. The v1 validation evidence in this repository was produced on macOS; Linux and Windows should be treated as portability targets until their CI matrices are added.

The Skill is designed for Codex and Claude Code style local agents. Install it in `~/.codex/skills/personal-os` or `~/.claude/skills/personal-os`; product-specific plugin manifests are adapters, while `SKILL.md` and the packaged `scripts/pos.mjs` remain the source of truth. A global `pos` command is optional.

The installer also supports the shared `~/.agents/skills/personal-os` location and an explicit `--skill-dir` for WorkBuddy, QCode, Kimi, or other hosts. The shared location is an interoperability option, not a guarantee that every host discovers it. Undocumented product paths are never guessed.

The host Agent must support reading the Skill and invoking local Node.js files. Natural-language clarification and routing occur in that host model. The embedded runtime is model-independent and does not make network or LLM calls. If a host cannot discover Skills but can explicitly read instructions and execute the runtime, label it compatibility mode.

Interactive approval is an optional capability layer. The installer currently detects locally configured Codex and Claude Code CLIs and can register the bundled stdio MCP server by default. A host that supports MCP form elicitation renders a native confirmation panel; clients without it receive a fail-closed exact-text fallback. WorkBuddy, QCode, Kimi, and other hosts can use the same MCP server when their documented integration supports stdio MCP and elicitation, but the installer does not guess undocumented configuration paths.

At runtime, the invoking product should pass a stable Host ID so temporary work is isolated under `99_AI/hosts/<host-id>/runs/`. Codex, Claude Code, and other products are Hosts; `research`, `creator`, `builder`, and `reviewer` are separate task Roles. Unknown adapters use `generic` rather than guessing identity from user content.

Git is optional. Personal OS also keeps task-scoped rollback snapshots under `.pos/history/` so a formal change remains reversible without Git.

New-root initialization deliberately refuses an existing non-empty target on every supported platform. Existing directories use a separate read-only audit and reviewed copy-to-new-root migration path; in-place takeover remains unsupported.
