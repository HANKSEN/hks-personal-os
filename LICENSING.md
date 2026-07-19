# Licensing / 许可说明

Hks Personal OS 从 v1.1.0 起采用“开放许可 + 商业许可”的双许可模式。目标是允许个人、团队和商业机构广泛使用、修改和传播，同时为不希望承担 Copyleft / ShareAlike 义务的集成保留商业授权空间。

**English summary:** From v1.1.0, functional software is offered under AGPL-3.0-or-later and original explanatory documentation under CC BY-SA 4.0. Both licenses allow commercial use when their reciprocal conditions are met. A separate commercial license is available for proprietary integration or non-ShareAlike documentation use. The published v1.0.0 remains MIT licensed, and user-created content does not become project-licensed merely because Personal OS was used.

> 本说明帮助理解仓库的许可边界，不构成法律意见。商业发布、融资、并购或大规模集成前，建议结合所在司法辖区咨询专业律师。

## 1. 软件与功能性材料

以下内容以及未另行声明的文件采用 [`AGPL-3.0-or-later`](LICENSE)：

- `scripts/**`、`install.sh` 和测试代码；
- `SKILL.md`、`AGENT_INSTALL.md` 和 `agents/**`；
- `assets/**` 中的 Agent Manifest、模板和策略；
- `.claude-plugin/**`、`.codex-plugin/**` 等功能性适配器。

AGPL 允许免费运行、修改、复制、分发和商业使用。分发修改版，或通过网络向用户提供修改版服务时，需要按照 AGPL 提供相应源代码并保留许可义务。精确权利与义务以 [`LICENSE`](LICENSE) 的完整文本为准。

## 2. 原创设计文档与方法论

[`LICENSE-DOCS.md`](LICENSE-DOCS.md) 列出的文档与原创图示采用 `CC BY-SA 4.0`。它允许复制、翻译、改编、公开传播和商业使用；公开分享改编版时，需要署名、说明修改并使用相同或兼容许可。

`CC BY-SA 4.0` 只用于文档和图示，不用于软件代码。第三方引用、链接内容和标准许可证文本仍按各自权利处理。

## 3. 商业许可

如果你的使用方式需要以下一项或多项，可以申请单独商业许可：

- 将 Personal OS 功能集成到闭源产品、SaaS、企业内部发行版或商业 Agent 中，同时免除 AGPL 源代码公开义务；
- 改编、再包装或分发设计文档，同时免除 CC BY-SA 的署名或同方式共享义务；
- 获得特定版本、组织规模、品牌使用、再分发、OEM、支持、培训或定制条款；
- 需要采购合同、SLA、保证、赔偿、合规材料或其他双方书面约定。

商业许可不是使用本项目的前提。能够遵守 AGPL 和 CC BY-SA 的个人、组织与商业主体都可以继续免费使用公开版本。

发起商业授权联系时，可在 GitHub 仓库创建标题为 `[Commercial License]` 的 Issue，仅提供公开联系需求；不要在公开 Issue 中提交商业机密、个人信息或凭证。双方建立私密渠道后再交换详细资料。

## 4. 用户内容与个人资产

你使用 Personal OS 创建、整理或保存的文章、笔记、数据、个人上下文和其他输出，**不会仅因使用本工具而自动适用 AGPL 或 CC BY-SA**。这些内容的权利由其原作者、输入来源和用户选择决定。

如果输出复制或改编了本仓库中具有独创性的模板、文档或代码，则相应部分仍可能受其许可证约束。外部文章、模型输出和第三方数据也可能有各自的权利限制。

## 5. 版本边界

- Git 标签 `v1.0.0` 及在许可切换前已经以 MIT 发布的对应代码，继续依据不可撤销的 MIT 许可使用；文本保存在 [`LICENSES/MIT-v1.0.0.txt`](LICENSES/MIT-v1.0.0.txt)。
- v1.1.0 及后续版本按本文件定义的 AGPL / CC BY-SA 双层范围发布，除非某个文件或未来版本另有明确说明。
- 旧版本的 MIT 权利不会因仓库后续更换许可证而被收回；新版本新增内容也不会自动回溯适用 MIT。

## 6. 快速判断

| 使用方式 | 是否可免费 | 主要条件 |
|---|---|---|
| 个人本地安装和修改 | 是 | 遵守 AGPL；不对外分发/提供修改版服务时通常没有发布源代码的触发行为 |
| 公司内部使用未修改公开版本 | 是 | 保留许可与版权信息；结合实际部署方式核对 AGPL |
| 销售公开版本的安装、培训或支持 | 是 | 可以收费，继续遵守 AGPL / CC BY-SA |
| 发布修改版或提供修改版网络服务 | 是 | 按 AGPL 向相应用户提供完整对应源代码 |
| 改编并发布设计文档 | 是 | 署名、标注修改、使用 CC BY-SA 或兼容许可 |
| 闭源集成且不履行上述对等义务 | 需商业许可 | 与版权持有人签订单独协议 |

如表格与正式许可证文本冲突，以正式许可证和双方书面商业协议为准。
