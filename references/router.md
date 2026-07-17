# Intent Discovery and Router Protocol

## Task intents

- `capture`: retain an input without deeper processing.
- `explore`: understand or systematically research something.
- `create`: produce an article, video, report, Skill, code, or other deliverable.
- `execute`: continue or complete an already framed task.
- `decide`: compare options and support a user-owned choice.
- `review`: analyze a completed action, outcome, or dataset.
- `maintain`: organize, update, archive, or diagnose the Personal OS.

Intent describes the action. It does not by itself determine the destination.

## Routing priority

1. Honor an explicit user-selected path, Area, or Project if authorized and valid.
2. Prefer the currently selected Project when the request advances its outcome.
3. Reuse an existing strongly matching active Project rather than creating a duplicate.
4. Route durable work to its owning Area.
5. Route classified external reference material without an active owner to Resources.
6. Keep unresolved input in Inbox or an AI Run.

Choose one primary owner. Link secondary Areas instead of making duplicate files.

## Minimum clarification

Ask one concise question when the answer would materially change:

- the primary Area or Project;
- the deliverable;
- whether anything should persist;
- the permission or risk level;
- an external publication or action.

Do not block on ambiguity that affects only a tag, filename, or reversible draft. State the assumption and continue inside `99_AI/`.

Do not use an uncalibrated numeric confidence score as the sole permission decision.

## Task Card

Every persistent task must record:

- request and intended change;
- intent and deliverable;
- primary Area and Project;
- persistence choice;
- context references;
- write scope;
- risk and approval requirement;
- assumptions and missing information.
