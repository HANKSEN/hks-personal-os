# Hks Personal OS RFC

RFC（Request for Comments）记录会长期影响兼容性、资产语义、安全或商业边界的设计决策。

## 状态

- `proposed`：正在讨论，不能作为稳定协议依赖；
- `accepted`：已被当前实现采用；
- `superseded`：已由新 RFC 取代，历史仍保留；
- `rejected`：已评估但未采用。

## 已接受 RFC

| RFC | 决策 | 状态 |
|---|---|---|
| [0001](0001-inbox-as-router.md) | Inbox 作为统一入口和意图路由层 | accepted |
| [0002](0002-five-asset-model.md) | PARA 与五类正式资产正交 | accepted |
| [0003](0003-changeset-write-protocol.md) | Agent 正式写入使用隔离 Run 与 Changeset | accepted |
| [0004](0004-interactive-approval.md) | 交互审批只是 Changeset 的安全界面，不是新的写入通道 | accepted |
| [0005](0005-batch-safe-approval-and-large-file-copy.md) | 一项任务可拆成独立审批与 Undo 的批次，大型文件走哈希绑定的原样复制 | accepted |

## 提交要求

新的 RFC 至少说明：问题、约束、决策、替代方案、后果、兼容/迁移、安全影响和验收方式。RFC 不得包含个人资产、凭证、私有商业计划或未获授权的第三方内容。

本目录文档采用 [CC BY-SA 4.0](../LICENSE-DOCS.md)。贡献前请阅读 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。
