# 多 Agent 工作区与旧目录升级

[English](ai-workspaces.en.md) | 简体中文

`99_AI` 是临时执行区，不是正式知识库。它按实际执行任务的 Agent 宿主隔离，而不是按“研究、创作、开发、复盘”等任务角色建目录。

## Host、Role、Run

| 概念 | 示例 | 作用 |
|---|---|---|
| Host | `codex`、`claude-code`、`workbuddy` | 标记实际由哪个 Agent 产品执行，并拥有物理工作区 |
| Role | `research`、`creator`、`builder`、`reviewer` | 描述这次任务采用什么能力配置，不拥有用户目录 |
| Run | 一次任务 ID | 收口该次任务的上下文、草稿、提案、日志和结果 |

```text
99_AI/
├── CONTEXT.md
├── hosts/
│   ├── codex/
│   │   ├── CONTEXT.md
│   │   └── runs/<run-id>/{work,proposed,logs,...}
│   └── claude-code/
│       ├── CONTEXT.md
│       └── runs/<run-id>/{work,proposed,logs,...}
├── shared/handoffs/
└── trash/
```

Role Profile 保存在已安装 Skill 的 `assets/roles/` 中。Personal OS 数据目录不再复制 `builder / creator / reviewer` 等逻辑 Agent 文件夹。

## 日常规则

1. 调用 Skill 的 Agent 应把自身稳定标识作为 `host`；不能识别时使用 `generic`，不要从个人文件内容猜测。
2. 草稿、生成文件、任务级操作摘要和错误记录留在当前 Run。日志不要保存密码、Token、私有思维过程或完整供应商遥测。
3. 一个 Run 只属于一个 Host。换 Agent 接力时，在 `shared/handoffs/` 留显式交接摘要，由新 Host 创建新 Run；不要直接修改另一个 Host 的 Run。
4. 需要长期保存的结果，经 Changeset 预览和用户批准后，进入 Project、Area、Resource 或 Archive。`99_AI` 整体不进入正式资产索引。
5. `trash/`、`.pos` 事务与 Apply 锁是所有 Host 共用的安全控制区。

高级命令示例：

```bash
pos run <root> --goal "完成一篇文章" --host codex --role creator
pos run <root> --goal "复盘文章数据" --host claude-code --role reviewer
```

全局 CLI 仍是可选项；Agent 可直接调用已安装 Skill 包中的 `scripts/pos.mjs`。

## 已有用户升级

软件更新与 Personal OS 数据目录升级是两次独立授权。更新 Skill 不会搜索或改动任何数据根目录。只有用户明确给出某个已初始化根目录后，才执行：

```bash
# 只预览，不改文件
pos workspace-upgrade <root>

# 查看完整移动、创建和策略更新后，明确批准
pos workspace-upgrade <root> --yes
```

升级会保守处理未知历史：

- `99_AI/runs` → `99_AI/hosts/legacy/runs`
- `99_AI/agents` → `99_AI/shared/legacy-roles`
- `99_AI/proposed` → `99_AI/shared/legacy-proposed`

系统不会猜测历史 Run 来自哪个 Agent。目标冲突时会停止；中途失败会恢复已移动目录、策略和 layout marker。升级前仍必须完整备份根目录并验证可以恢复。

升级完成后运行 `pos doctor <root>`，再分别用常用 Host 创建一个测试 Run，确认路径隔离、正式 Changeset 预览和 Undo 正常。
