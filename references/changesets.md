# Changeset Protocol

A Changeset is the handoff between the LLM Skill and the deterministic CLI. The Skill drafts proposed content and writes `CHANGESET.json`; the `pos` CLI validates paths, policy, scope, hashes, and conflicts. The CLI does not generate semantic content or decide where knowledge belongs.

## Schema

```json
{
  "schema": "pos.changeset.v1",
  "taskId": "task-id",
  "changeId": "task-id--batch-01",
  "summary": "Why this change exists",
  "writeScope": ["20_Areas/示例领域/Experience/**"],
  "operations": [
    {
      "id": "op-001",
      "action": "create",
      "path": "20_Areas/示例领域/Experience/example.md",
      "source": "99_AI/hosts/codex/runs/task-id/proposed/op-001.md",
      "reason": "Record the time-bound result"
    }
  ]
}
```

Supported actions are `create`, `update`, `move`, `archive`, and `trash`. There is no `delete` action.

`taskId` identifies the user request and Agent Run. Optional `changeId` identifies one independently approved and undoable batch inside that Task. Omit it for a single-batch legacy-compatible Changeset; the runtime then uses `taskId`. When a plan exceeds the policy operation limit, split it by a meaningful boundary and give every batch a distinct `changeId`. The returned `undoId` is the batch's `changeId`.

For `create` and `update`, provide either inline `content` or a `source` file inside the same authorized Personal OS. Prefer a source inside the current Run's `proposed/` directory.

For a large byte-preserving create, use a staged `source` plus `"mode": "opaque-copy"`. The runtime streams its SHA-256, shows only size/hash metadata in the preview, revalidates it immediately before apply, and atomically copies it without changing compression or format. Opaque copy is create-only and remains bounded by `policy.maxOpaqueCopyBytes`.

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

## Interactive approval

`propose` turns a valid preview into an immutable approval record under `.pos/approvals/`. The record binds the exact Changeset path, operation list and SHA-256 plan digest. A later approval applies only that digest; if the Changeset or referenced content changes, the proposal becomes `stale` and a fresh preview is required.

Compatible Agent hosts may render the proposal through the bundled MCP adapter as a native form with **Approve**, **Revise**, **Reject**, and **Cancel** actions. The visual control is convenience, not authority: the deterministic runtime still validates the bound digest, write scope, protected-content gate and filesystem state. Hosts without form elicitation fall back to the exact phrase `APPROVE <proposal-id>`.

## Apply and undo sequence

```bash
pos apply /absolute/path/to/root 99_AI/hosts/<host-id>/runs/<task-id>/CHANGESET.json
pos propose /absolute/path/to/root 99_AI/hosts/<host-id>/runs/<task-id>/CHANGESET.json
pos decide /absolute/path/to/root <proposal-id> --decision approve
pos apply /absolute/path/to/root 99_AI/hosts/<host-id>/runs/<task-id>/CHANGESET.json --yes
pos doctor /absolute/path/to/root
pos undo /absolute/path/to/root <undo-id> --yes
```

The first command is preview-only. Review the returned write scope, operations, destinations, hashes, protected flags, and diffs before adding `--yes`. Protected Context requires a separately approved `--approve-protected` flag.

Undo deliberately requires `--yes`. Use the `undoId` returned by Apply or approval; for legacy single-batch work it equals the Task ID. Undo normally refuses if later edits conflict with the stored after-state. `--force` bypasses that protection and can overwrite later work, so it requires explicit risk acceptance rather than routine use.
