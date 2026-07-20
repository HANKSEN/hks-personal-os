# Update and rollback

Hks Personal OS uses target-release-driven updates and keeps old versions available for rollback. A software update switches the Skill and any existing optional CLI; it does not discover, read, or modify a Personal OS data root.

> Keep an independent, restore-tested backup of valuable Personal OS data before updating. Software update, Undo, Git, and cloud history are not data backups.

## Lowest-friction update

Give an Agent the official repository or an explicit release URL and say:

```text
Read AGENT_UPDATE.md and update my installed Hks Personal OS to this version.
Show the plan and every path first. Do not read or modify my Personal OS data root; wait for my approval before applying.
```

The target release performs the update. It verifies packages, discovers managed Skill links and any existing optional CLI, detects interactive-approval host integrations, displays the complete plan, atomically switches software links after approval, configures supported adapters, retains the previous version, and asks you to start a new Agent session. Adapter failure falls back to exact proposal-ID text confirmation and does not access a Personal OS data root. Use `--no-interactive-approval` to opt out.

## Command-line form

From a trusted target release checkout:

```bash
node scripts/install.mjs update --dry-run --json
node scripts/install.mjs update --yes --json
```

Or execute an explicit GitHub version tag without installing a global CLI:

```bash
npx --yes github:HANKSEN/hks-personal-os#<version-tag> update
```

For an undiscoverable custom host Skill directory:

```bash
node scripts/install.mjs update --agent none --skill-dir <skill-parent>
```

An existing optional CLI is preserved automatically. Use `--with-cli` only to add it explicitly.

## What changes

| Object | Behavior |
|---|---|
| Target package | Copied to `versions/<version>`, manifested, and verified |
| Skill links | Switched after approval |
| Existing optional CLI | Preserved and switched |
| Previous package | Retained for rollback |
| `install-state.json` | Stores software versions and managed software paths only |
| Personal OS data roots | Not discovered, read, migrated, or modified |

All managed links and software state switch as one transaction. A failure restores previous links. A copied but inactive target directory does not count as success.

## `99_AI` data-root upgrade

v1.1 introduces host-isolated `99_AI/hosts/<host-id>/runs/`. A software update never discovers or modifies Personal OS data roots. If the user later selects one legacy root, first create an independent backup, then separately preview:

```bash
node <installed-skill-root>/scripts/pos.mjs workspace-upgrade <root>
```

Add `--yes` only after reviewing every move, Context creation, and policy update. Historical host identity is unknown, so old Runs move to `hosts/legacy/runs`; the system never guesses. See [Multi-Agent workspace upgrade](ai-workspaces.en.md).

## Rollback

Rollback activates an already installed version:

```bash
node <installed-skill-root>/scripts/install.mjs rollback --to <installed-version> --dry-run --json
node <installed-skill-root>/scripts/install.mjs rollback --to <installed-version> --yes --json
```

It does not reverse Personal OS content. Any future data-schema migration or reversal requires a separate root-specific, previewable, authorized workflow. See [`AGENT_UPDATE.md`](../AGENT_UPDATE.md) for the complete Agent protocol.
