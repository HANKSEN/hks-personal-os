---
type: ai-host-context
status: active
host_id: {{host_id}}
---

# {{host_id}}

## Scope

This workspace belongs to Runs executed by the `{{host_id}}` Agent host.

## Rules

- Keep temporary work inside the current Run.
- Record the selected Role separately; a Role is not an Agent host.
- Do not write into another host's Run. Use `99_AI/shared/handoffs/` and create a new Run when work changes host.
- Promote durable output only through a reviewed Changeset.
- Logs should contain task-level actions and errors, not secrets, private reasoning, or raw provider telemetry.
