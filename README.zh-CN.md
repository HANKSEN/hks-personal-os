# Hks Personal OS

简体中文 | [English](README.md)

Personal OS 是一套本地优先的个人信息与 AI 协作协议，由三部分组成：

- 基于 Markdown 文件的个人信息系统；
- 供 Codex、Claude Code 等本地 Agent 使用的 Skill；
- 零运行时依赖的 Node.js 命令行工具 `pos`。

它让用户可以直接从自然语言或一个 Inbox 文件开始，由 AI 澄清意图、定位相关领域、加载必要上下文并在隔离工作区中协作；需要写入正式文件时，再通过可预览、可审批、可审计、可撤销的 Changeset 完成。

> Personal OS 不是让 AI 接管你的文件，而是让人负责目标和判断，让 AI 在明确边界内降低整理、检索、创作与复盘的维护成本。

> [!WARNING]
> 在首次授权任何 Agent 访问有价值的文件前，请先完成整个目录及附件的独立备份，并实际验证备份可以恢复。Personal OS 的 Changeset、Undo、Git 和云端版本历史都不能替代完整备份。安装器只安装软件，不会自动备份个人数据。详见[安全提示与免责声明](docs/safety.md)。

## 最简单的安装方式

### 把 GitHub 链接交给 Agent

把开源后的仓库链接发送给 Codex、Claude Code、WorkBuddy、QCode、Kimi Agent 或其他具备本地文件和终端能力的 Agent，并附上：

```text
请打开这个 GitHub 仓库，先阅读根目录 AGENT_INSTALL.md，预览你准备创建的所有安装路径；得到我确认后完成安装并验证。不要初始化或读取我的个人数据目录。
```

Agent 会根据 [AGENT_INSTALL.md](AGENT_INSTALL.md) 检查 Node.js、识别真实 Skill 目录、预览安装位置，再经过确认安装。对于没有稳定公开 Skill 路径的宿主，Agent 必须使用该宿主实际支持的目录，不能猜测。

### 一行命令安装

从 GitHub 一行安装：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --yes
```

常用目标：

```bash
# Codex
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent codex --yes

# Claude Code
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent claude --yes

# 通用 Agents Skills 目录，并自动识别已存在的 Codex/Claude
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --yes

# WorkBuddy、QCode、Kimi 或其他宿主提供了明确的 Skill 父目录
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent none --skill-dir "/真实的/skills/父目录" --yes
```

不加 `--yes` 时只输出安装计划；`--dry-run --json` 可用于 Agent 预检。安装默认进入用户目录，不使用 `sudo`，也不会初始化 Personal OS 数据根目录。

## 解决什么问题

传统文件夹或知识库通常依赖用户自己完成分类、检索和维护，接入 AI 后还会出现几个新问题：

- 用户不知道一个问题应该从哪个文件夹或工作区开始；
- AI 每次读取全部资料会浪费上下文和 Token；
- 外部资料、个人认知、真实经验和公开产物容易混在一起；
- AI 直接写入正式文件，可能造成误改、覆盖或错误归档；
- 一次行动结束后，经验没有继续沉淀成可复用的方法和工具。

Personal OS 将这些问题拆成一条稳定的数据流：

```text
自然语言 / 文件输入
        ↓
意图澄清与任务路由
        ↓
按需检索个人上下文
        ↓
隔离的 AI Run
        ↓
提案与 Changeset 预览
        ↓
人工批准后写入正式资产
        ↓
数据、经验、原则与产物继续复用
```

## 人和 AI 的职责边界

Personal OS 明确区分语义决策和文件操作：

- Codex/Claude Skill 负责理解自然语言、必要追问、意图分类、上下文选择、内容起草和路由建议。
- `pos` CLI 负责确定性的初始化、索引、上下文检索、Run 创建、Changeset 校验、文件写入、审计和撤销。
- CLI 本身不会调用大模型，不会自动判断用户意图，也不会将数据发送到网络。
- AI 可以在当前 `99_AI/runs/<task-id>/` 内起草；正式资产只能通过 Changeset 写入。

## 文件体系

根目录使用 PARA 管理物理位置：

```text
Personal_OS/
├── POS.md                 # 个人核心上下文与全局协作规则
├── 00_Inbox/              # 尚未判断归属的输入和任务入口
├── 10_Projects/           # 有目标和完成条件的阶段性工作
├── 20_Areas/              # 需要长期经营的责任领域
├── 30_Resources/          # 已分类但尚未转化为个人知识的外部资料
├── 90_Archive/            # 已结束或暂时不活跃的内容
├── 99_AI/                 # Agent、隔离 Run、提案和软删除区
└── .pos/                  # 索引、策略、审计、事务和撤销历史
```

每个 Area 内部使用五类资产表达内容的意义：

```text
20_Areas/<领域>/
├── CONTEXT.md
├── Knowledge/             # 我理解了什么
├── Experience/            # 我在什么情境下做了什么，结果如何
├── Principles/            # 从证据中提炼出的原则、SOP、方法或 Playbook
├── Artifacts/             # 已完成、发布或可交付的文章、视频、代码、Skill 等
└── Data/                  # 指标、测量结果及其他结构化事实
```

几个关键边界：

- `Inbox` 是尚未判断价值和归属的统一入口；`Resources` 是已经确认主题、但还没有转化为个人理解的外部资料。
- 写作过程保留在 Project；正式发布后的唯一规范版本进入所属 Area 的 `Artifacts`。
- 一次行动、选择、实验或复盘属于 `Experience`；只有得到足够证据支持的可复用规律才进入 `Principles`。
- 外部文章的摘要不会被默认当成用户自己的 `Knowledge`。

详细规则见 [文件体系规范](references/file-system.md) 和 [核心工作流](references/workflows.md)。

## Inbox 与自然语言路由

用户不必先选择文件夹，可以直接表达：

- “帮我读这篇长文，我以后可能会用来写文章。”
- “我为什么连续几篇内容点击率都很低？”
- “把这个创作 SOP 做成一个可以复用的 Skill。”
- “我还不知道这个问题属于学习、创作还是工作研究。”

Skill 会先判断期望变化和交付物，再选择一级意图：

```text
capture / explore / create / execute / decide / review / maintain
```

只有当缺失信息会改变主要归属、交付物、持久化方式、风险或外部操作时，才进行一次最小必要追问。可逆的草稿工作可以在说明假设后直接进入 AI Run。

## 上下文加载

Personal OS 不要求 AI 每次扫描整个目录：

1. 始终加载精简的 `POS.md`；
2. 根据任务加载一个主要 Area 和一个主要 Project 的 `CONTEXT.md`；
3. 从可重建的本地 JSONL 索引中检索少量相关资产；
4. 默认最多返回 8 个资产、48,000 字符；
5. 没有相关个人上下文时明确报告缺口，不虚构历史。

`.pos/index.jsonl` 只是缓存，删除后可以通过 `pos index` 重建；Markdown 文件始终是事实来源。

## 安全写入与撤销

正式文件写入遵循以下流程：

```text
Run 内起草 → 生成 CHANGESET.json → 预览 → 人工确认 → apply → 审计 / undo
```

主要安全规则：

- 所有命令都要求明确传入 Personal OS 根目录，不向上搜索目录；
- 默认 `collaborative` 模式下，正式写入必须先预览并显式添加 `--yes`；
- 修改 `POS.md` 或 `CONTEXT.md` 还需要单独的受保护内容批准；
- 支持 `create`、`update`、`move`、`archive` 和 `trash`，不提供永久删除操作；
- 拒绝绝对路径、父目录穿越、NUL、符号链接逃逸及大小写/Unicode 路径别名；
- Apply 失败会恢复事务前状态；Undo 遇到后续编辑冲突时默认拒绝覆盖；
- 导入文件中的 Prompt Injection 只会被当成文本数据，不能改变策略或写入范围。

## 从本地源码安装

要求 Node.js 20 或更高版本。

已经下载或克隆仓库时，可以运行：

```bash
./install.sh --agent auto --dry-run
./install.sh --agent auto --yes
```

完整说明和故障处理见[安装文档](docs/install.md)。

## 快速开始

只能初始化一个全新或空目录。v1.0 不会接管、迁移或重组已有知识库。

```bash
pos init /absolute/path/to/new-personal-os \
  --areas "学习,工作"

pos doctor /absolute/path/to/new-personal-os
```

初始化后，先填写精简的 `POS.md` 和 Area `CONTEXT.md`，再让 Codex 或 Claude 使用 `personal-os` Skill 处理自然语言任务。

如果准备把已有文件逐步复制到新系统，先完成原目录的独立备份。v1.0 不会自动迁移旧目录。

常用命令：

```text
pos init <root> [--areas "领域A,领域B"] [--mode safe|collaborative|trusted]
pos index <root>
pos context <root> [--query "..."] [--area "..."] [--project "..."]
pos run <root> --goal "..." [--agent orchestrator] [--write-scope "path/**"]
pos apply <root> <changeset> [--yes] [--approve-protected]
pos undo <root> <task-id> --yes [--force]
pos doctor <root>
pos help [--json]
```

建议按照 [15 分钟首次运行指引](docs/first-run.md) 完成一次“创建 Knowledge → 预览 → Apply → Undo”的完整闭环。

## 权限模式

- `safe`：只允许 AI 在当前工作区内自动写入，拒绝正式资产写入。
- `collaborative`：默认模式；AI 起草，人确认后写入正式资产。
- `trusted`：仍受路径、范围、Changeset 和审计约束，但适合用户主动授权的自动化流程。

初次使用建议保持 `collaborative`。

## 当前状态

Hks Personal OS v1.0 是面向全新目录的本地版本，当前包含：

- 完整的 Starter Kit、Skill、Agent Manifest 和 CLI；
- 50 项隔离自动化测试；
- 10,000 文件规模的索引与上下文边界测试；
- 五类 Changeset 操作的 Apply/Undo 故障恢复测试；
- 路径、权限、符号链接、历史完整性和 Prompt Injection 安全测试。

当前验证环境为 macOS。Linux 和 Windows 是兼容目标，在加入对应 CI 矩阵前不声明已完成跨平台验收。

v1.0 暂不包含：

- 既有知识库迁移；
- 自动调用模型；
- GUI、云同步、向量数据库或知识图谱；
- 自动发布内容、安装 Skill 或执行投资交易；
- 永久删除。

## 开发与验证

```bash
npm run check
npm test
npm run validate
```

测试只使用新生成的系统临时目录和虚构数据，不允许把已有个人系统作为开发或验收目标。

公开开发资料：

- [Skill 操作协议](SKILL.md)
- [安装指南](docs/install.md)
- [安全提示与免责声明](docs/safety.md)
- [文件体系规范](references/file-system.md)

内部需求 Spec、技术设计、实施任务和验收过程不包含在公开发行仓库中。

## License

[MIT](LICENSE)
