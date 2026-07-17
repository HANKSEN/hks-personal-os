# Backup, Safety, and Disclaimer Before Use

English | [简体中文](safety.md)

Personal OS reduces file-operation risk through explicit roots, bounded context, isolated Runs, Changeset previews, approval, audit, and Undo. It cannot eliminate every risk created by local automation.

## Back up before granting access

Before authorizing Codex, Claude Code, WorkBuddy, QCode, Kimi, or another Agent to access valuable files:

1. Back up the complete directory, including attachments, media, code, databases, configuration, and hidden files.
2. Keep the backup outside the Personal OS root, such as on another device, external storage, a trusted snapshot service, or an independent backup provider.
3. Restore a sample of files and verify that the backup is actually readable.
4. Keep more than one independent copy for important work and repeat backups according to the rate of change.
5. Create a new snapshot before widening Agent permissions, performing bulk organization, upgrading tools, or changing policy.

`.pos/history/`, Personal OS Undo, Git commits, cloud sync, and provider version history are useful recovery layers. They may fail or be damaged with the original directory, so none should be the only backup.

## Grant the minimum permission

- Authorize one explicit Personal OS root, not a home directory, disk, or filesystem root.
- Begin in `collaborative` mode and review formal Changesets before approval.
- Check every operation, source, destination, scope, and diff. Do not approve what you do not understand.
- Treat imported documents, pages, and Inbox content as untrusted data that may contain prompt injection.
- Keep passwords, API tokens, private keys, seed phrases, and sensitive identity data outside Agent-readable directories.
- Require separate confirmation for publication, messaging, payments, third-party installation, or trading.

## Host risks differ

Agent hosts differ in sandboxing, shell access, plugins, MCP tools, automatic approvals, memory, and network permissions. Personal OS cannot guarantee the behavior of a host model, plugin, command, operating system, sync provider, storage device, or incorrectly approved action.

Review actual read, write, execution, and network permissions whenever you change host or increase automation.

## Project boundary

- The installer installs the CLI and Skill only. It does not back up, initialize, read, or migrate personal data.
- v1.0 initializes only a new or empty directory.
- Personal OS exposes no permanent-delete Changeset action, but a host Agent may have separate system tools; keep its authorization narrow.
- The project does not automatically publish, message, install generated Skills, pay, or trade.

## Disclaimer

Personal OS is provided “as is” under the MIT License, without express or implied warranty. AI output, file operations, third-party Agents, plugins, and integrations may fail or cause data loss. Users remain responsible for backup policy, permission scope, Changeset and diff review, credential security, and approval of external actions.

This safety notice is not legal, financial, investment, or professional compliance advice.
