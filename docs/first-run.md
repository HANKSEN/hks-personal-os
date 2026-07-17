# 15-minute first run

This walkthrough creates and then safely undoes one Knowledge note. Use a brand-new empty directory; never substitute an existing knowledge base, PARA folder, Obsidian vault, or other personal system.

Before granting any Agent access to valuable files, create an independent full-directory backup or snapshot and verify that selected files can be restored. Personal OS Undo history, Git, and cloud sync are additional recovery layers, not replacements for a backup. Read [safety.md](safety.md) before continuing.

In the examples, replace `/absolute/path/to/demo-pos` with one absolute path you control. Keep that same path throughout.

## 1. Verify installation (1 minute)

```bash
pos help
```

Stop if this fails. Follow [install.md](install.md) before continuing.

## 2. Initialize the empty root (1 minute)

```bash
pos init /absolute/path/to/demo-pos --areas "示例领域"
pos doctor /absolute/path/to/demo-pos
```

This uses the default `collaborative` mode. Do not choose `safe` or `trusted` for the first run: they are advanced policy modes, not beginner presets.

## 3. Add the minimum human context (3 minutes)

Open `/absolute/path/to/demo-pos/POS.md` and fill only these fields:

```markdown
## Identity and current stage

- Role: 正在建立个人内容体系的创作者
- Current stage: 初期验证

## Goals

- This year's focus: 稳定产出 AI 与个人成长内容
- Current priority: 建立低维护成本的创作工作流
```

Then open `/absolute/path/to/demo-pos/20_Areas/示例领域/CONTEXT.md` and fill:

```markdown
## Purpose

通过可持续的学习与实践建立可复用的知识与方法。

## AI collaboration

- AI may: 澄清意图、检索相关上下文、在 99_AI 内起草、生成 Changeset
- AI should propose before: 写入 Area 正式资产
- AI must not: 未经预览与批准直接修改正式资产
```

Refresh the index:

```bash
pos index /absolute/path/to/demo-pos
```

## 4. Trigger the Skill in natural language (2 minutes)

Start a new Codex task or Claude Code session and send this exact request:

```text
Use the personal-os Skill. My authorized Personal OS root is /absolute/path/to/demo-pos.
I want to understand what a Personal OS is for later use. Ask at most one necessary clarification question, then route this as a Knowledge asset owned by the 示例领域 Area.
Create an isolated run with the formal write scope limited to 20_Areas/示例领域/Knowledge/personal-os-basics.md. Draft only in the run's proposed directory, generate a Changeset, and stop after preview. Do not apply it for me.
```

The Skill/host LLM performs clarification and routing. The `pos` CLI does not interpret this natural language. The agent should invoke the equivalent deterministic command:

```bash
pos run /absolute/path/to/demo-pos \
  --goal "形成一份 Personal OS 基础知识说明" \
  --intent explore \
  --area "示例领域" \
  --agent research \
  --write-scope "20_Areas/示例领域/Knowledge/personal-os-basics.md"
```

Save the returned `taskId` and `run` path. They identify the review and undo boundary.

## 5. Verify the proposal and Changeset (3 minutes)

Inside `99_AI/runs/<task-id>/`, the agent should have:

- drafted the note as `proposed/op-001.md`;
- filled `CHANGESET.json` with one `create` operation;
- kept both Task Card and Changeset `writeScope` equal to `20_Areas/示例领域/Knowledge/personal-os-basics.md`;
- left the formal Area unchanged.

The Changeset should have this shape:

```json
{
  "schema": "pos.changeset.v1",
  "taskId": "<task-id>",
  "summary": "Create a reusable Personal OS basics note",
  "writeScope": [
    "20_Areas/示例领域/Knowledge/personal-os-basics.md"
  ],
  "operations": [
    {
      "id": "op-001",
      "action": "create",
      "path": "20_Areas/示例领域/Knowledge/personal-os-basics.md",
      "source": "99_AI/runs/<task-id>/proposed/op-001.md",
      "reason": "Persist the user-reviewed synthesis"
    }
  ]
}
```

If the agent did not create these files, ask it to finish the proposal inside the same Run. There is intentionally no `pos generate` command: content and semantic placement come from the Skill/LLM.

## 6. Preview, approve, and diagnose (3 minutes)

Preview first; this does not change the formal Area:

```bash
pos apply /absolute/path/to/demo-pos 99_AI/runs/<task-id>/CHANGESET.json
```

Check that there is exactly one `create`, that its destination is the scoped Knowledge path, and that no Context or unrelated path is listed. Then apply explicitly:

```bash
pos apply /absolute/path/to/demo-pos 99_AI/runs/<task-id>/CHANGESET.json --yes
pos doctor /absolute/path/to/demo-pos
```

Confirm that `20_Areas/示例领域/Knowledge/personal-os-basics.md` exists and `doctor` reports a healthy root.

Return to the same Codex task or Claude Code session and say:

```text
The Changeset has been applied. Complete this Run's RESULT.md now: set status to applied, set undo_id to the task ID, record the context used and the one changed file, and ensure task.json and RESULT.md agree. Do not make any new formal change.
```

Check the completed `RESULT.md` before closing the task. The CLI records deterministic transaction state; the Skill/host LLM completes the semantic result record.

## 7. Test recovery with undo (2 minutes)

Review `.pos/history/<task-id>/manifest.json`, then undo:

```bash
pos undo /absolute/path/to/demo-pos <task-id> --yes
pos doctor /absolute/path/to/demo-pos
```

The Knowledge note should be removed because it did not exist before the apply, while the Run, history, and audit records remain. `--yes` is mandatory.

Return once more to the same Skill task and ask it to update the existing Run result to `undone`, retain the original outcome and changed-file history, and note that the formal file was restored to its pre-apply state. This keeps `task.json`, `RESULT.md`, and the user-facing result consistent.

Do not add `--force` in this walkthrough. If later edits conflict with the stored after-state, normal undo stops to protect them. `--force` bypasses that check and can overwrite later work; it is only for an explicitly accepted recovery risk.

## Completion check

The first run passes when all of these are true:

- the human supplied only compact root and Area context;
- the Skill clarified/routed natural language without a full-directory scan;
- `pos run` recorded a narrow explicit write scope;
- the proposal stayed inside `99_AI/` until approval;
- preview made no formal change;
- apply created exactly the reviewed file;
- `doctor` passed after apply and undo;
- undo restored the pre-apply formal state without `--force`.
- `task.json` and `RESULT.md` agree after both apply and undo.
