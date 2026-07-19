# 来源与溯源

## 目的

本项目公开的是“来源如何影响设计”，不是把外部文章、作者历史知识或内部聊天复制进仓库。每条重要原则都应尽量形成以下链路：

```text
公开来源 → 作者的明确理解 → 设计原则/RFC → 协议或代码 → 测试/验收
```

如果一个主张只是项目作者的原创设计判断，应明确标记为原创，而不是借权威来源为其背书。

## 主要来源

| 来源 | 本项目采用的部分 | 没有直接推导出的部分 |
|---|---|---|
| [Tiago Forte：The PARA Method](https://fortelabs.com/blog/para/) | Projects、Areas、Resources、Archives 作为按可行动性组织的简单骨架 | Inbox Router、五类资产、AI Run 与 Changeset 是本项目扩展 |
| [Agent Skills Specification](https://agentskills.io/specification) | `SKILL.md`、references、scripts、assets 的可移植结构与渐进式加载 | Personal OS 的任务分类、目录模型和安全写入协议 |
| [Agent Skills：Progressive Disclosure](https://agentskills.io/home) | 只在需要时加载完整 Skill 和资源，控制上下文占用 | `.pos` 索引预算和 Context 结果格式是本项目实现 |
| [Anthropic：Claude Code memory](https://docs.anthropic.com/zh-CN/docs/claude-code/memory) | 在目录层级用一份结构化上下文文件表达项目规则的实践启发 | `POS.md`、Area/Project Context 的字段和权限由本项目定义 |
| [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | 外部网页、邮件、文件中的指令必须视为不可信输入 | Changeset、显式根目录与无外部动作等具体控制由本项目设计 |
| [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) | 软件可自由使用、修改和分发，同时保留网络使用场景的源代码对等义务 | 商业例外是版权持有人提供的独立许可选项 |
| [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原创设计文档可传播、改编和商业使用，并保持署名与同方式共享 | 软件代码不使用 CC 许可 |

## 来源到验证的示例

| 来源/观察 | 作者理解 | 系统规则 | 实现位置 | 验收证据 |
|---|---|---|---|---|
| PARA 强调简单和可行动性 | 根目录不应复制人生全部主题分类 | 只保留少量稳定一级空间 | `references/file-system.md` | Init 与结构测试 |
| Skill 渐进式加载 | 每次不应扫描整个仓库 | Core → Area/Project → 预算内资产 | `references/context-protocol.md` | 10,000 文件边界测试 |
| 外部内容可能含间接注入 | 文档内容不能成为系统指令 | 导入内容不改变策略、写域或外部动作 | `references/security.md` | Prompt Injection 安全测试 |
| Agent 写入具有不确定性 | 语义判断与文件提交必须分层 | 隔离 Run → Changeset → Preview → Apply | `references/changesets.md` | Apply/Undo/故障恢复测试 |
| 用户需要积累自己的方法 | 不能把单次结论直接称为原则 | Experience → candidate → confirmed Principle | `references/workflows.md` | 创作和投资工作流测试 |

## 原创设计贡献

以下内容是 Hks Personal OS 在上述基础上的组合与扩展：

- 把 Inbox 定义为统一意图入口和 Router，而不只是临时收件箱；
- 将 PARA 物理骨架与 Knowledge、Experience、Principles、Artifacts、Data 语义资产分离；
- 用最小澄清规则决定何时追问、何时在隔离区带假设继续；
- 用 Skill 作为语义控制面、确定性 CLI 作为文件数据面；
- 用 Run、Changeset、保护 Context、事务、审计和 Undo 约束 Agent 写入；
- 用公开 Foundation + RFC 解释设计，同时将原始 Spec 与个人资料保留在私有研发层。

## 引用与收录规则

- 优先链接原始作者、正式规范或权威项目页面；
- 只摘录实现所需的最小信息，长段内容使用自己的语言总结；
- 记录访问日期或版本，尤其是会变化的 Agent 规范；
- 外部材料的原许可继续有效；仓库的 CC BY-SA 不会把第三方内容重新授权；
- 不收录付费资料、个人聊天、未授权数据和无法确认来源的“二手理论”；
- 对设计有实质影响的新来源，应更新本页或通过 RFC 说明。

最后核对日期：2026-07-17。
