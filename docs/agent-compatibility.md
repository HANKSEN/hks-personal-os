# Agent 兼容与安装适配

Personal OS 把兼容性拆成三层，避免把“能读取一个仓库”误写成“已完成原生安装”：

1. **原生 Skill**：宿主有公开、稳定的 Skill 目录或安装命令；
2. **插件适配**：宿主能加载包含 `skills/` 与 MCP 配置的插件包；
3. **通用回退**：写入 Agent Skills 公共目录；若宿主不发现该目录，则由 Agent 显式读取 `SKILL.md` 或由用户提供 `--skill-dir`。

## 当前适配矩阵

| Agent | 安装参数 | 接入方式 | 支持等级 |
|---|---|---|---|
| Codex | `--agent codex` | `~/.codex/skills` + 可选 MCP | 已验证原生 |
| Claude Code | `--agent claude` | `~/.claude/skills` + 插件/MCP | 已验证原生 |
| OpenClaw | `--agent openclaw` | `~/.openclaw/skills` | 已验证原生 |
| Hermes Agent | `--agent hermes` | `~/.hermes/skills` | 已验证原生 |
| WorkBuddy | `--agent workbuddy` | `.workbuddy-plugin` + `~/.agents/skills` 回退 | 已验证插件兼容 |
| CodeBuddy | `--agent codebuddy` | `.codebuddy-plugin` + `~/.agents/skills` 回退 | 已验证插件兼容 |
| TRAE | `--agent trae` | Agent Skills 公共目录或宿主显式导入 | 通用标准回退 |
| TRAE SOLO | `--agent trae-solo` | Agent Skills 公共目录或宿主显式导入 | 通用标准回退 |
| Kimi / QCode / Qoder | 对应名称 | Agent Skills 公共目录或 `--skill-dir` | 通用标准回退 |
| Cursor / Windsurf / Cline / Roo Code / OpenCode / Gemini CLI | 对应名称 | Agent Skills 公共目录或 `--skill-dir` | 通用标准回退 |

“通用标准回退”不等于虚构宿主的私有目录。安装结果会明确返回 `support`、`activation`、`evidence`、`plannedSkillTargets` 和插件清单路径，Agent 必须据此报告是原生、插件还是兼容模式。

## 自动检测

`--agent auto` 总是准备 `~/.agents/skills/personal-os`，并只对本机真实检测到的宿主增加适配：

- 已存在的宿主配置目录；
- `PATH` 中实际存在的宿主命令；
- 已公开且稳定的原生 Skill 路径。

安装器不会仅凭用户在聊天里提到某个 Agent 就创建其私有目录。`--agent all` 是用户明确要求的全适配模式，会创建所有已验证原生入口，并准备通用回退与插件清单。

## 本地诊断

安装包到达本机后，可先做完全离线、无写入的诊断：

```bash
node scripts/install.mjs diagnose --agent auto --json
```

诊断会报告 Node 版本、TTY 状态、检测到的宿主、计划安装位置、适配等级与弱网风险，不会读取或初始化 Personal OS 数据目录。

## 官方依据

- [Agent Skills 开放规范](https://agentskills.io)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)
- [Hermes Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [CodeBuddy / WorkBuddy 插件参考](https://www.codebuddy.cn/docs/cli/plugins-reference)
- [TRAE Skills](https://docs.trae.ai/ide/skills)

上游产品可能改变目录、清单或命令。新增原生路径前必须有官方依据和隔离安装测试；否则继续使用通用回退或显式 `--skill-dir`。
