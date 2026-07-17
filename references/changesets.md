# Changeset Protocol

A Changeset is the handoff between the LLM Skill and the deterministic CLI. The Skill drafts proposed content and writes `CHANGESET.json`; the `pos` CLI validates paths, policy, scope, hashes, and conflicts. The CLI does not generate semantic content or decide where knowledge belongs.

## Schema

```json
{
  "schema": "pos.changeset.v1",
  "taskId": "task-id",
  "summary": "Why this change exists",
  "writeScope": ["20_Areas/示例领域/Experience/**"],
  "operations": [
    {
      "id": "op-001",
      "action": "create",
      "path": "20_Areas/示例领域/Experience/example.md",
      "source": "99_AI/runs/task-id/proposed/op-001.md",
      "reason": "Record the time-bound result"
    }
  ]
}
```

Supported actions are `create`, `update`, `move`, `archive`, and `trash`. There is no `delete` action.

For `create` and `update`, provide either inline `content` or a `source` file inside the same authorized Personal OS. Prefer a source inside the current Run's `proposed/` directory.

For `update` and source-side moves, provide `expectedHash` when possible. The CLI must reject stale content instead of overwriting it.

For `move`, provide `from` and `path`. For `archive` and `trash`, provide `from`; the CLI derives a collision-safe destination.

## Planning requirements

Planning must reject:

- absolute or out-of-root paths;
- symlink paths;
- writes outside both policy and `writeScope`;
- duplicate or conflicting operations;
- create over an existing path;
- update of a missing path;
- permanent deletion;
- sources outside the Personal OS root;
- more operations than the policy limit.

When the destination introduces a new Area or Project, the same Changeset must create that container's `CONTEXT.md`. This prevents durable work from being written into an owner with no local routing rules.

Previewing a Changeset must not modify formal files, the index, or the audit log.

## Apply and undo sequence

```bash
pos apply /absolute/path/to/root 99_AI/runs/<task-id>/CHANGESET.json
pos apply /absolute/path/to/root 99_AI/runs/<task-id>/CHANGESET.json --yes
pos doctor /absolute/path/to/root
pos undo /absolute/path/to/root <task-id> --yes
```

The first command is preview-only. Review the returned write scope, operations, destinations, hashes, protected flags, and diffs before adding `--yes`. Protected Context requires a separately approved `--approve-protected` flag.

Undo deliberately requires `--yes`. It normally refuses if later edits conflict with the stored after-state. `--force` bypasses that protection and can overwrite later work, so it requires explicit risk acceptance rather than routine use.
