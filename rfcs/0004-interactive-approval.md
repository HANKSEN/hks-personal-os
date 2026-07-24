# RFC 0004：不可变更的交互审批

- 状态：accepted
- 版本：1.3.0

## 问题

用户每次手动输入“同意”既繁琐又含糊；但若把对话按钮直接当成文件权限，又会产生误写、旧预览授权新内容和受保护上下文被顺带修改的风险。

## 决策

1. Changeset 预览后生成持久化审批提案，绑定任务、宿主、操作列表和计划摘要。
2. 非 Codex Agent 客户端支持 MCP form elicitation 且能保持可审阅布局时，可展示原生交互面板；不支持时降级为包含提案 ID 的精确文本确认。
3. 安装器检测到可配置的 Codex 或 Claude Code 宿主时，默认注册本地 MCP 适配器；可用 `--no-interactive-approval` 退出。
4. 批准仅可消费一次；摘要不同、内容已变、提案过期或需要受保护内容二次批准时，运行时拒绝写入。
5. Codex 桌面端优先使用对话内结构化审批卡：卡片展示文件表格、写入范围、风险、摘要与四种决定；按钮只通过 `sendFollowUpMessage` 返回绑定提案 ID 和完整计划摘要的决策，不直接调用文件写入。
6. Agent 收到卡片回传后必须重新读取持久化审批记录，核对 `proposalId`、`awaiting_approval` 状态和完整 `planDigest`，再调用确定性 `decide`。其他宿主继续使用 MCP form elicitation 或精确文本回退。
7. Codex 原生 MCP 表单不得承载 Personal OS 的正式审批正文。若 Codex 调用 `personal_os_review`，适配器只返回 `pos.interaction-handoff.v1`，要求生成对话内审批卡；不得发起 elicitation、消费提案或写入文件。

## 后果

用户在支持的对话窗口中可以点击批准、要求修改、拒绝或取消，同时保留与 CLI 一致的确定性安全边界。Codex 中由 Personal OS 提供可控的结构化审批卡，MCP 只承担提案协议与安全执行；其他宿主的原生面板外观仍由宿主决定。

## 验收

- 支持 elicitation 的模拟客户端可点击完成四种决策；
- 不支持的客户端只获得文本回退，不自动写入；
- 批准后更改 Changeset 必须失败；
- 受保护内容必须有额外批准；
- 安装器对可支持宿主默认开启，失败时保留 Skill 和文本回退能力。
- Codex 审批卡必须保持表格、范围与操作按钮可读，且按钮只回传决策消息；伪造摘要、旧提案、已决提案均不能触发写入。
- Codex 身份的 MCP 客户端调用 `personal_os_review` 时不得收到 `elicitation/create`；必须收到可恢复的 inline-visual handoff，且提案仍为 `awaiting_approval`。
