# 版本更新与回退指南

Hks Personal OS 的更新采用“**新版本驱动更新、旧版本保留回退**”的方式。更新只替换 Skill 及可选 CLI 的软件链接，不会查找、读取或改写你的 Personal OS 内容目录。

> 更新前仍建议对有价值的 Personal OS 目录做一次独立完整备份，并验证能够恢复。软件更新、Undo、Git 或云端历史都不是数据备份。

## 最简单的更新方式

把官方仓库或明确版本的 Release 链接交给 Agent，然后说：

```text
请阅读 AGENT_UPDATE.md，把我已安装的 Hks Personal OS 更新到这个版本。
先展示更新计划和所有路径，不要读取或修改我的 Personal OS 数据目录；等我确认后再执行。
```

Agent 会从你提供的目标版本执行更新，而不是让旧版本自行猜测最新版。它会：

1. 读取目标版本和更新说明；
2. 找到现有受管 Skill、已经安装的可选 CLI，以及可配置的交互审批宿主；
3. 校验现有版本和目标版本的完整性；
4. 展示版本、路径、警告与数据边界；
5. 获得确认后复制新版本并原子切换链接；
6. 在兼容宿主中默认启用审批适配器，保留旧版本，并提示新开 Agent 会话。

适配器配置失败不会使 Skill 更新失效，系统会回退到绑定提案 ID 的文本确认；整个过程仍不读取 Personal OS 数据根。可用 `--no-interactive-approval` 退出自动配置。

## 一行命令

如果你明确需要命令行，可在可信的目标版本源码目录运行：

```bash
node scripts/install.mjs update
```

非交互式自动化必须先预览，再单独批准：

```bash
node scripts/install.mjs update --dry-run --json
node scripts/install.mjs update --yes --json
```

也可以直接从明确的 GitHub 版本标签临时执行，避免先安装 CLI：

```bash
npx --yes github:HANKSEN/hks-personal-os#<version-tag> update
```

若原来安装在宿主自定义的 Skill 目录，且更新器无法自动发现，请显式提供其父目录：

```bash
node scripts/install.mjs update --agent none --skill-dir <skill-parent>
```

`--with-cli` 只用于新增可选 CLI。已经安装的 CLI 会自动保留并更新，不需要重复声明。

## 更新会改什么

| 对象 | 更新行为 |
|---|---|
| 新版本软件包 | 复制到用户级 `versions/<version>`，生成文件哈希清单并校验 |
| Skill 链接 | 确认后切换到新版本 |
| 已有可选 CLI | 自动随版本切换 |
| 旧版本软件包 | 保留，用于回退 |
| `install-state.json` | 只记录版本和受管软件路径，不记录个人数据目录 |
| Personal OS 数据目录 | 不发现、不读取、不迁移、不修改 |

所有链接和安装状态作为一个事务切换。中途失败时会恢复旧链接；一个已复制但未激活的新版本不等于更新成功。

## `99_AI` 数据目录升级

v1.1 引入按实际 Agent 宿主隔离的 `99_AI/hosts/<host-id>/runs/`。软件更新不会搜索或修改任何 Personal OS 数据根。若用户之后明确选择一个旧根目录，应先完成独立备份，再单独预览：

```bash
node <installed-skill-root>/scripts/pos.mjs workspace-upgrade <root>
```

确认全部移动、Context 与 policy 变化后才添加 `--yes`。历史 Run 的真实宿主未知，因此统一进入 `hosts/legacy/runs`，不会由 AI 猜测。完整流程见[多 Agent 工作区升级](ai-workspaces.md)。

## 回退

回退只能激活本机已安装的版本：

```bash
node <installed-skill-root>/scripts/install.mjs rollback --to <installed-version> --dry-run --json
node <installed-skill-root>/scripts/install.mjs rollback --to <installed-version> --yes --json
```

回退只切换软件，不会倒回你的文章、知识、项目或其他 Personal OS 数据。如果未来某个版本引入数据结构迁移，数据迁移和数据回退必须是另一套单独授权、可预览、可恢复的流程。

## 常见结果

- `up-to-date`：当前已是目标版本，完整性正常。
- `upgrade`：目标版本高于当前版本。
- `repair-metadata-or-targets`：版本相同，但需要补足旧安装的完整性元数据或恢复已确认的软件目标。
- `legacy-unverified`：旧版本早于完整性清单，只能验证必要运行文件；可以回退，但会明确警告。

遇到完整性不匹配、同版本内容不同、无受管安装或路径冲突时，系统会停止，不会强行覆盖。完整 Agent 协议见 [`AGENT_UPDATE.md`](../AGENT_UPDATE.md)。
