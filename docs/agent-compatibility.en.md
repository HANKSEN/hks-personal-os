# Agent compatibility and installation adapters

Personal OS reports compatibility in three explicit tiers:

1. **Native Skill**: a stable public Skill directory or installer is documented;
2. **Plugin adapter**: the host loads a bundle containing `skills/` and MCP configuration;
3. **Standard fallback**: install into the shared Agent Skills directory, then use explicit import or `--skill-dir` if the host does not discover it.

| Agent | Option | Adapter | Grade |
|---|---|---|---|
| Codex | `--agent codex` | `~/.codex/skills` + optional MCP | verified native |
| Claude Code | `--agent claude` | `~/.claude/skills` + plugin/MCP | verified native |
| OpenClaw | `--agent openclaw` | `~/.openclaw/skills` | verified native |
| Hermes Agent | `--agent hermes` | `~/.hermes/skills` | verified native |
| WorkBuddy | `--agent workbuddy` | `.workbuddy-plugin` + shared fallback | verified plugin compatible |
| CodeBuddy | `--agent codebuddy` | `.codebuddy-plugin` + shared fallback | verified plugin compatible |
| TRAE / TRAE SOLO | `--agent trae` / `--agent trae-solo` | shared standard or explicit host import | standard fallback |
| Kimi, QCode, Qoder, Cursor, Windsurf, Cline, Roo Code, OpenCode, Gemini CLI | matching name | shared standard or `--skill-dir` | standard fallback |

`--agent auto` always prepares `~/.agents/skills/personal-os` and adds adapters only for observed local signals. It never invents a private directory because a product name appeared in conversation.

Run a local, offline, no-write diagnosis:

```bash
node scripts/install.mjs diagnose --agent auto --json
```

Upstream evidence:

- [Agent Skills](https://agentskills.io)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)
- [Hermes Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [CodeBuddy / WorkBuddy plugins](https://www.codebuddy.cn/docs/cli/plugins-reference)
- [TRAE Skills](https://docs.trae.ai/ide/skills)

Private paths may change. A new native adapter requires official evidence and an isolated install test; otherwise Personal OS remains on the standard fallback.
