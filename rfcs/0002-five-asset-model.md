# RFC 0002：PARA 与五类资产正交

- 状态：accepted
- 日期：2026-07-17
- 影响：目录、元数据、工作流、检索

## 问题

只使用 PARA 时，项目和领域的行动边界清晰，但已发布文章、平台数据、一次复盘、个人知识和可复用 SOP 仍可能混在一起。若再创建一个与 Area 平级的 Creation/Memory 目录，又会把主题、过程和产物三个维度混用。

## 决策

PARA 只表达物理归属和当前可行动性；每个 Area 可以维护五类正式资产：

- Knowledge：综合后的可复用理解；
- Experience：带时间和结果的行动、决策、实验或复盘；
- Principles：有证据支撑的规则、SOP、方法或 Playbook；
- Artifacts：已完成、发布或交付的成果；
- Data：可核查的事实、指标和导出。

生产中的材料留在 Project。完成后只提升一个规范 Artifact，其他空间通过链接关联。

## 为什么取消通用 Memory

Memory 无法稳定区分外部知识、个人经历、复盘结果和抽象原则。Experience 与 Principles 分开后，AI 可以保留原始情境，同时避免把一次观察过早泛化成长期规则。

## 替代方案

- **全局 Creation 目录**：便于按文件类型浏览，但与创作 Area 和 Project 重叠。
- **全局 Memory 目录**：概念宽泛，路由和检索难以形成一致标准。
- **只用标签不分语义**：目录简单，但 Agent 难以确定证据与产物的生命周期规则。

## 后果

- 一个内容可以与多个 Area/Project 关联，但只有一个主要所有者和规范副本；
- AI 摘要不会自动成为用户 Knowledge；
- Principle 需要 Experience/Data 证据和用户确认；
- Data 与 Experience 分开，避免把相关性直接当因果解释。

## 验收

- 创作流程能把草稿、发布物、指标、复盘和 SOP 分别落到正确位置；
- 投资流程能分开来源、知识模型、选择/结果、数据与原则；
- 已发布 Artifact 不在 Project 与 Area 形成两个规范副本；
- 单次复盘默认只产生 Principle candidate。
