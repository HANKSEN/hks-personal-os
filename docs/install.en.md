# Install and initialize Hks Personal OS

[简体中文](install.md) | English

The default is **Skill-first**. The Skill package contains the deterministic local runtime used for initialization, indexing, Changesets, Doctor, Undo, read-only audit, and copy migration. A global `pos` CLI is optional and is not required for normal use.

> [!WARNING]
> Software installation does not authorize access to personal files. Before any Agent reads a valuable existing directory, create an independent full backup and restore-test it. See [Safety and disclaimer](safety.en.md).

## Requirements

- Node.js 20 or later;
- a local Agent that can read a Skill and execute local Node.js files;
- no `sudo` and no runtime npm dependencies.

## Recommended: give the GitHub URL to your Agent

Send the repository URL and this request to Codex, Claude Code, WorkBuddy, QCode, Kimi, or another local Agent:

```text
Open https://github.com/HANKSEN/hks-personal-os and read AGENT_SETUP.md completely.
Install and initialize Hks Personal OS according to its safety boundaries.
Install the Skill only by default; do not install a global CLI.
After installation, continue by asking whether I want a new system or a read-only audit of an existing directory.
Before each permission boundary changes, show the exact paths and access mode and wait for confirmation.
```

The Agent should continue through installation, workspace choice, initialization or backup-gated read-only audit, health verification, and one optional real first task. Installation, initialization, source reading, copy migration, and formal Changeset apply are separate authorizations.

## One interactive command

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup --agent auto
```

The interactive setup asks for installation approval, journey, and exact workspace path. By default it installs a versioned package and Skill entry, but no global CLI and no PATH change.

No-write structured preview:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup \
  --agent auto --dry-run --json
```

## Agent and machine mode

Agents can consume the stable `personal-os.setup.v1` response and continue from `state`, `pendingAuthorization`, and `nextAction`:

```bash
node scripts/install.mjs setup \
  --agent codex --yes \
  --workspace-mode new \
  --root "/absolute/path/to/Personal_OS" \
  --json
```

This stops before root mutation. Add `--initialize` only after the user confirms that exact missing or empty path. `--areas "Creation,Tool Development"` is optional.

## Agent targets

| Host | Option | Default Skill path |
|---|---|---|
| Auto | `--agent auto` | Generic, plus detected Codex/Claude locations |
| Generic Agents Skills | `--agent generic` | `~/.agents/skills/personal-os` |
| Codex | `--agent codex` | `~/.codex/skills/personal-os` |
| Claude Code | `--agent claude` | `~/.claude/skills/personal-os` |
| Explicit custom host | `--agent none --skill-dir <parent>` | User- or host-provided path |

Personal OS never guesses undocumented WorkBuddy, QCode, Kimi, or other host paths. When native discovery is unavailable, an Agent may explicitly read the installed `SKILL.md` and invoke the packaged `scripts/pos.mjs`; report this as compatibility mode.

## Optional global CLI

Install CLI links only for terminal, scripting, CI, or troubleshooting:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup \
  --agent auto --with-cli
```

This adds `pos` and `personal-os` links. It does not grant access to a personal data directory.

## Local repository and install-only

```bash
./install.sh setup --agent auto
./install.sh setup --agent auto --install-only
```

The second command intentionally stops after software verification.

## Successful result

Expect the result to include installed version, Skill paths, `embeddedRuntime`, default `globalCliInstalled: false`, and—after initialization—`health.healthy: true` plus `START_HERE.md`. Some hosts require a new Agent session to discover a newly installed Skill.

The installer refuses unrelated collisions, reuses a valid same-version package, and never removes a Personal OS data root. Existing users should follow the previewable, rollback-capable [update guide](update.en.md) and `AGENT_UPDATE.md` instead of overwriting an installed version. Continue with the [first-use guide](first-run.en.md) or the [existing-directory guide](existing-directory.en.md).
