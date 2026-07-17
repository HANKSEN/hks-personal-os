# Install Personal OS

English | [简体中文](install.md)

## Safety boundary first

The installer installs the Personal OS software and Skill only. It does not back up, initialize, read, migrate, or organize a personal data root.

Before granting an Agent access to valuable files, create a complete independent backup, keep it outside the source directory, restore-test selected files, and read [the safety and disclaimer guide](safety.en.md). Changesets, Undo, Git, and cloud version history are not substitutes for a backup.

## Requirements

- Node.js 20 or later with npm/npx;
- a local Agent with filesystem, terminal, and Skill/instruction-file support;
- macOS or Linux. Windows remains a portability target until independent CI validation is added.

Installation uses no `sudo`. Defaults:

```text
Software: ~/.local/share/personal-os/versions/<version>/
Commands: ~/.local/bin/
```

The installer refuses unrelated existing files, commands, links, or Skill directories.

## Give the GitHub URL to an Agent

Send the repository URL and this request:

```text
Open this repository and read AGENT_INSTALL.md. Check Node.js and the Skill directory your host actually supports. Use dry-run to show every destination, wait for my confirmation, then install and verify pos help. Do not initialize, read, or migrate a personal data directory.
```

The Agent must follow [AGENT_INSTALL.md](../AGENT_INSTALL.md), preview all paths, and request confirmation before installation. Software-install authorization does not authorize access to personal content.

## One command from GitHub

Run directly from GitHub:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --yes
```

Preview without applying:

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --dry-run --json
```

Explicit targets:

```bash
# Codex
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent codex --yes

# Claude Code
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent claude --yes

# A host with a documented custom Skill parent
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent none --skill-dir "/real/skills/parent" --yes
```

## Install from a local clone

```bash
cd /absolute/path/to/personal-os
./install.sh --agent auto --dry-run
./install.sh --agent auto --yes
```

The installer copies the runtime package into versioned user-owned storage, links `pos` and `personal-os`, and links the Skill into selected targets. It runs no npm lifecycle script and has no runtime npm dependency.

## Agent targets

```text
auto     ~/.agents/skills plus detected ~/.codex and ~/.claude
generic  ~/.agents/skills/personal-os
codex    ~/.codex/skills/personal-os
claude   ~/.claude/skills/personal-os
none     CLI only, unless --skill-dir is supplied
```

For WorkBuddy, QCode, Kimi, or another host, obtain the real supported Skill parent from its documentation, settings, or the host Agent, then use `--skill-dir`. Personal OS never guesses an undocumented product path. The shared Agents Skills directory is an interoperability option, not a discovery guarantee.

Repeat `--skill-dir` to install into multiple explicitly supported parents.

## PATH

If the result reports that `~/.local/bin` is not on `PATH`, add it to the relevant shell configuration:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Open a new terminal and verify:

```bash
command -v pos
pos help
```

An Agent may use the returned absolute binary path for verification but should not edit shell configuration without approval.

## Verify and begin

Confirm the reported Skill destination contains `SKILL.md`, then restart or open a new Agent session. Do not automatically scan or adopt an existing data directory.

Read [the 15-minute first run](first-run.md), select a new or empty target, and initialize explicitly:

```bash
pos init /absolute/path/to/new-personal-os --areas "Learning,Work"
pos doctor /absolute/path/to/new-personal-os
```

If old material will be used later, back it up first and manually copy a small selected batch into the new root's `00_Inbox`. v1.0 does not perform in-place migration.

## Conflicts and removal

The installer reuses the same managed version and may repoint managed links from an older version while retaining the old directory. It refuses ordinary files, unrelated links, unmarked version directories, and existing ordinary Skill directories.

Do not solve collisions or uninstall with broad recursive deletion. Inspect the exact reported links, preview removals, preserve version directories until rollback is unnecessary, and never touch a Personal OS data root as part of software removal.
