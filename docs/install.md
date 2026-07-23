# 安装与初始化 Hks Personal OS

[English](install.en.md) | 简体中文

普通用户只需要安装 **Skill**。Skill 包内已经包含初始化、索引、Changeset、Doctor、Undo、只读审计和复制迁移所需的确定性本地运行时；全局 `pos` CLI 只面向终端、自动化和故障排查，不是必要安装项。

> [!WARNING]
> 软件安装不等于授权访问个人文件。在让 Agent 读取任何有价值的旧目录前，请先做完整独立备份，并随机恢复文件确认备份可用。详见[安全提示与免责声明](safety.md)。

## 环境要求

- Node.js 20 或更高版本；
- 能读取本地 Skill 并执行本地 Node.js 文件的 Agent；
- 不需要 `sudo`，也不需要安装 npm 运行时依赖。

## 最推荐：把 GitHub 链接发给 Agent

把仓库链接和下面这段话发给 Codex、Claude Code、WorkBuddy、QCode、Kimi Agent 或其他本地 Agent：

```text
请打开 https://github.com/HANKSEN/hks-personal-os ，完整阅读 AGENT_SETUP.md，
按协议帮我安装并初始化 Hks Personal OS。默认只安装 Skill，不安装全局 CLI。
安装后不要结束：继续问我是“新建一套”还是“整理已有目录”。
每次授权范围变化前，先说明精确路径、读写方式和安全影响，并等我确认。
```

Agent 会连续完成：

1. 检查 Node.js 和真实的 Skill 安装目录；
2. 无写入预览安装位置；
3. 经确认后安装 Skill 和内置运行时；
4. 检测宿主的交互审批能力；支持时默认注册本地审批适配器；
5. 询问“新建一套”还是“整理已有目录”；
6. 确认数据路径后初始化，或在备份门槛后只读审计旧目录；
7. 运行健康检查；
8. 用一篇文章、一个问题或一项真实任务带用户完成第一次使用。

安装、初始化、旧目录读取、复制迁移和正式 Changeset Apply 是不同授权，不会因为第一次确认而自动放开后续权限。

## 一行命令：交互式 Setup

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup --agent auto
```

终端会依次询问安装、工作空间模式和目标路径。默认创建：

```text
~/.local/share/personal-os/versions/<version>/   # 自包含版本包
~/.agents/skills/personal-os                     # 通用 Skill 入口
```

如果已经存在 Codex 或 Claude Code 的用户配置目录，`--agent auto` 还会安装相应 Skill 入口。默认不会创建 `~/.local/bin/pos`，也不要求配置 `PATH`。

### 交互审批的默认行为

安装器会检测 Codex 和 Claude Code 的本地宿主命令。能够安全注册 MCP 适配器时，它会在安装计划中显示精确动作，经过安装确认后默认开启。新会话中，Codex 使用对话内结构化审批卡；其他兼容宿主仅在原生表单能保持可审阅布局时展示“批准 / 要求修改 / 拒绝 / 取消”。

- 检测不到或注册失败：Skill 仍正常安装，改用绑定提案 ID 的明确文本确认；
- 不想自动配置：添加 `--no-interactive-approval`；
- 配置冲突：安装器不覆盖同名的其他 MCP 服务，而是报告冲突并保留文本回退。

交互面板不会扩大权限。它批准的是某一个已预览计划的摘要；文件内容变化后旧批准自动失效，受保护的 `POS.md` / `CONTEXT.md` 仍需要额外确认。

只想先看完整安装计划，不写任何文件：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup \
  --agent auto --dry-run --json
```

## Agent 自动化调用

Agent 可以逐步读取 `personal-os.setup.v1` 的 `state`、`pendingAuthorization` 和 `nextAction`，用自然语言继续引导。例如新建模式：

```bash
node scripts/install.mjs setup \
  --agent codex \
  --yes \
  --workspace-mode new \
  --root "/absolute/path/to/Personal_OS" \
  --json
```

上面只会停在初始化确认。用户确认精确路径后，再增加：

```text
--initialize
```

可选 Area：

```text
--areas "创作,个体工具开发"
```

不填写 Area 也会得到一套健康目录，之后可以在第一次真实任务中按需创建。

## 宿主安装目标

| 宿主 | 参数 | 默认 Skill 位置 |
|---|---|---|
| 自动识别 | `--agent auto` | 通用位置，并适配已检测到的 Codex / Claude |
| 通用 Agents Skills | `--agent generic` | `~/.agents/skills/personal-os` |
| Codex | `--agent codex` | `~/.codex/skills/personal-os` |
| Claude Code | `--agent claude` | `~/.claude/skills/personal-os` |
| 明确自定义宿主 | `--agent none --skill-dir <父目录>` | 用户或宿主明确提供的位置 |

Personal OS 不猜测 WorkBuddy、QCode、Kimi 等不同版本的未公开目录。若宿主不能自动发现 Skill，但能读取文件和运行 Node.js，可以让 Agent 显式读取已安装版本中的 `SKILL.md` 和调用同包 `scripts/pos.mjs`；此时应说明这是兼容模式，不是假装原生发现成功。

## 全局 CLI：仅在需要时安装

只有用户明确需要终端命令、脚本自动化或 CI 时才使用：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os setup \
  --agent auto --with-cli
```

这会额外创建 `pos` 和 `personal-os` 命令链接。普通 Skill 使用不需要它们。安装 CLI 仍不授予任何个人数据目录权限。

## 从本地仓库运行

```bash
cd /absolute/path/to/hks-personal-os
./install.sh setup --agent auto
```

结构化预检：

```bash
./install.sh setup --agent auto --dry-run --json
```

## 只安装，不初始化

高级用户可以显式停止在安装完成：

```bash
node scripts/install.mjs setup --agent auto --install-only
```

之后新开 Agent 会话，说“使用 personal-os Skill 帮我开始”，即可继续工作空间初始化。

## 验证是否成功

正常成功结果应包含：

- 安装版本与 Skill 绝对路径；
- `embeddedRuntime` 路径；
- `globalCliInstalled: false`（默认）；
- `interactiveApproval.enabled`：已启用的兼容宿主；若为空则显示文本回退；
- 初始化后的 `health.healthy: true`；
- 根目录中的 `START_HERE.md`；
- 下一步自然语言请求。

某些宿主只在启动时发现新 Skill，安装后需要新开一个 Agent 会话。

## 冲突、升级与卸载

- 安装器拒绝覆盖无关普通文件、目录或符号链接；
- 同版本重复运行会复用已有版本，不创建重复安装；
- 旧版本目录会保留，Skill 链接只在确认其属于 Personal OS 时更新；
- 不要为了排除冲突直接递归删除目录；
- 卸载软件时只移除已确认属于 Personal OS 的 Skill/CLI 链接，不触碰 Personal OS 数据根目录。

已安装用户应使用可预览、可回退的软件更新协议，不要覆盖安装目录。详见[版本更新与回退指南](update.md)和根目录的 `AGENT_UPDATE.md`。

安装完成后的两种用法见[首次使用指南](first-run.md)和[已有目录整理指南](existing-directory.md)。
