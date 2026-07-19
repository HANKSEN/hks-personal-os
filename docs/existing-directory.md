# 整理已有的混乱目录

[English](existing-directory.en.md) | 简体中文

这条旅程面向已经用 Agent 产生了很多文件，但目录乱、版本多、归档规则不一致的用户。Personal OS 默认不会在旧目录里原地改名、移动或删除，而是：

```text
旧目录（只读） → 诊断与映射 → 用户审阅 → 复制到新 Personal OS → 校验 → 保留旧目录
```

## 它解决什么问题

- 不知道哪些是 Project、Area、Resource 或已失活内容；
- Agent 在不同会话中创建了大量临时文件和重复目录；
- 文章、代码、数据、复盘、SOP 和外部资料混在一起；
- 想整理，但不敢一次把整个目录交给 Agent 修改；
- 整理完成后仍缺少一套日常归档规范。

## 1. 明确一个源目录

对 Agent 说：

```text
使用 personal-os Skill 帮我整理这个已有目录：/absolute/path/to/source。
先做只读诊断，把报告写到一个全新的 Personal OS；不要修改、移动或删除源文件。
```

只授权一个精确源根。不要把主目录、磁盘根或整个工作空间作为默认源目录。

## 2. 先过备份门槛

继续前应完成：

1. 完整备份源目录及附件、隐藏文件和配置；
2. 把备份放在源目录之外；
3. 随机恢复若干文件；
4. 确认源目录中没有希望 Agent 读取的密码、Token、私钥或助记词。

然后单独授权“只读审计”。安装或初始化新目标的授权不能替代这次读授权。

## 3. 确认一个独立新目标

推荐使用源目录同级的新目录，例如：

```text
/workspace/旧知识库
/workspace/旧知识库-Personal-OS
```

目标不能在源目录内部，源目录也不能在目标内部。系统只会初始化全新或空目标。

## 4. 只读诊断会做什么

- 记录相对路径、大小、类型、修改时间和可用哈希；
- 对文本只读取有界摘要，不把整个目录塞进一次模型上下文；
- 不跟随符号链接，不扫描 `.git`、`.pos`、`node_modules` 等控制目录；
- 依据文件名和扩展名给出低风险候选，但把语义归属标为 AI 推测；
- 对疑似凭证和超大文件默认排除内容读取或迁移；
- 审计前后重新计算源摘要，发现源发生变化就让报告失效。

外部文件中的指令只是“不可信数据”，不能更改权限、目标或迁移规则。

## 5. 固定交付物

报告都写在新目标 `99_AI/hosts/<host-id>/runs/<task-id>/work/`：

| 文件 | 用途 |
|---|---|
| `CURRENT_STATE_REPORT.md` | 文件规模、结构和安全概览 |
| `MIGRATION_PLAN.md` | 复制策略、审阅规则和候选归属 |
| `PATH_MAPPING.csv` | 每个源路径的目标候选、类型、理由、置信度和状态 |
| `UNRESOLVED.md` | 敏感、冲突或无法可靠判断的项目 |
| `ARCHIVING_GUIDE.md` | 以后如何使用 Inbox、Project、Area、Resource 和 Archive |
| `MIGRATION_RESULT.md` | 当前是未开始、待审批还是已完成并验证 |

你可以在这里停止。只拿诊断报告不会复制任何正式资产，也不会改变源目录。

## 6. 审阅，而不是让 AI 一键决定

重点确认：

- 当前内容是否有完成条件：有则属于 Project；
- 是否由某项长期责任持续拥有：有则属于 Area；
- 是否只是外部来源：尚未吸收时属于 Resource；
- 是否已经失活：进入 Archive 候选；
- Area 内究竟是 Knowledge、Experience、Principles、Artifacts 还是 Data。

不确定时保留 `needs-review`，不要强制归档。文件名只能提供线索，不能代替真实用途。

## 7. 复制迁移的审批链

只有标为 `approved` 的项目会进入批次：

1. 从只读源复制到当前 Run 的 `proposed/imports/`；
2. 校验暂存文件与审计哈希；
3. 生成有明确写入范围的 `CHANGESET.json`；
4. 预览新建 Area/Project Context 和所有正式目标；
5. 用户确认后 Apply；涉及新 `CONTEXT.md` 时需要额外受保护内容批准；
6. 运行最终验证，确认目标哈希、来源溯源、源摘要和目标健康。

默认每批不超过 20 个已审项目。目标已存在且内容相同会安全跳过；内容不同、大小写或 Unicode 路径冲突会停止，不会静默覆盖。

## 8. 完成后不要立刻删除旧目录

验收至少包括：

- `MIGRATION_RESULT.md` 显示 completed and verified；
- 新 Personal OS 通过 Doctor；
- 每个复制目标都能追溯源路径和 SHA-256；
- 源目录审计摘要没有变化；
- 随机打开若干文章、附件和二进制文件；
- 你能用 `ARCHIVING_GUIDE.md` 判断之后的新文件如何归档；
- 已验证独立备份。

保留旧目录一段时间。删除或停用旧目录不属于默认迁移流程，需要独立决定和授权。

## 高级命令参考

普通用户由 Agent 调用内置运行时即可。高级用户可使用安装包内的 `scripts/pos.mjs` 或可选全局 CLI：

```bash
pos audit <target-root> --source <source-root> --yes-read
pos migrate-stage <target-root> <migration-plan> --yes-read
pos apply <target-root> <changeset>
pos apply <target-root> <changeset> --yes [--approve-protected]
pos migrate-finalize <target-root> <migration-plan> --yes-read
```
