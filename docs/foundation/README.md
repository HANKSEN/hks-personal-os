# Hks Personal OS 设计基础

本目录公开 Hks Personal OS 的问题定义、核心模型、设计原则和验收方法，让使用者和贡献者理解系统为何这样设计。它不是内部研发档案的镜像。

## 阅读路径

1. [问题与受众](00-problem-and-audience.md)：为什么做、为谁做、解决什么。
2. [设计原则](01-design-principles.md)：哪些约束高于具体功能。
3. [概念模型](02-conceptual-model.md)：PARA、五类资产和项目如何协同。
4. [信息生命周期](03-information-lifecycle.md)：输入如何变成可复用资产。
5. [人机协作边界](04-human-ai-boundary.md)：人、Agent 和确定性本地运行时分别负责什么。
6. [安全模型](05-safety-model.md)：在本地文件写入场景中如何控制风险。
7. [验收方法](06-evaluation-method.md)：怎样证明系统有效且没有越界。
8. [来源与溯源](07-sources-and-provenance.md)：设计依据如何转化为规则和测试。

关键设计决策及替代方案记录在 [`rfcs/`](../../rfcs/README.md)。执行层的精确定义仍以 [`SKILL.md`](../../SKILL.md)、[`references/`](../../references/) 和 CLI 行为为准。

## 一句话模型

```mermaid
flowchart LR
    I["表达意图或放入文件"] --> F["澄清真实目标"]
    F --> R["路由并按需取回上下文"]
    R --> W["隔离工作"]
    W --> C["审阅后提交"]
    C --> A["形成正式资产"]
    A --> L["反馈、复盘与原则"]
    L --> R
```

Personal OS 的目标不是替用户维护一个更复杂的目录，而是让用户以低认知成本开始，让 AI 在可检查、可撤销的边界内把行动转化为下一次可复用的个人上下文。

## 许可

本目录中的原创文档与图示采用 [CC BY-SA 4.0](../../LICENSE-DOCS.md)；需要免除署名或同方式共享义务的使用方式，可参阅[商业许可说明](../../COMMERCIAL-LICENSE.md)。
