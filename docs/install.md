# 安装 Personal OS

[English](install.en.md) | 简体中文

## 使用前先确认安全边界

安装器只安装 Personal OS 软件和 Skill，不会备份、初始化、读取、迁移或整理任何个人数据目录。

在首次授权 Agent 访问有价值的文件前，请先：

1. 备份完整目录及附件；
2. 将备份保存在原目录之外；
3. 随机恢复几个文件，验证备份可用；
4. 阅读[备份、安全提示与免责声明](safety.md)。

Changeset、Undo、Git、云同步和服务商版本历史都不能代替独立备份。

## 环境要求

- Node.js 20 或更高版本；
- npm/npx；
- Codex、Claude Code 或其他支持本地文件、终端和 Skill/指令文件的 Agent；
- macOS 或 Linux。Windows 是兼容目标，但当前尚未完成独立 CI 验收。

安装不需要 `sudo`。默认软件目录为：

```text
~/.local/share/personal-os/versions/<version>/
```

默认命令目录为：

```text
~/.local/bin/
```

旧版本目录会保留。安装器不会覆盖无关的现有命令、普通文件或 Skill 目录。

## 方式一：把 GitHub 链接交给 Agent

适合不熟悉命令行的用户。

把仓库链接发送给当前 Agent，然后发送：

```text
请打开这个 GitHub 仓库并阅读根目录 AGENT_INSTALL.md。先检查 Node.js 和你实际支持的 Skill 目录，用 dry-run 展示准备创建的所有路径。得到我确认后完成安装并验证 pos help。不要初始化、读取或迁移任何个人数据目录。
```

Agent 应遵循 [AGENT_INSTALL.md](../AGENT_INSTALL.md)：

1. 在新临时目录克隆或下载仓库；
2. 阅读安装、安全和 Skill 协议；
3. 根据真实宿主选择安装目标；
4. 先执行 `--dry-run --json`；
5. 把完整安装路径展示给用户；
6. 用户确认后添加 `--yes`；
7. 验证 CLI 和 Skill；
8. 提醒用户重启或新建 Agent 会话。

安装软件的授权不等于授权 Agent 访问个人文件。

## 方式二：GitHub 一行命令

直接从 GitHub 安装：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --yes
```

这条命令会：

- 从 GitHub 临时获取软件包；
- 将稳定副本复制到用户级版本目录；
- 在 `~/.local/bin` 创建 `pos` 和 `personal-os` 命令；
- 安装通用 Agents Skills 入口；
- 自动识别已经存在的 Codex/Claude 用户配置目录；
- 输出安装位置、PATH 状态、重启提示和备份警告。

不加 `--yes` 时只生成计划：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --json
```

完全无写入的预检：

```bash
npx --yes --package=github:HANKSEN/hks-personal-os personal-os --agent auto --dry-run --json
```

## 方式三：从本地源码安装

已经下载或克隆仓库时：

```bash
cd /absolute/path/to/personal-os
./install.sh --agent auto --dry-run
./install.sh --agent auto --yes
```

也可以直接运行：

```bash
node scripts/install.mjs --agent auto --yes
```

安装器不运行 npm 生命周期脚本，也没有运行时 npm 依赖。

## 选择 Agent 目标

### 自动模式

```bash
personal-os --agent auto --yes
```

安装：

- 通用目录：`~/.agents/skills/personal-os`；
- 如果检测到 `~/.codex`，同时安装 Codex Skill；
- 如果检测到 `~/.claude`，同时安装 Claude Code Skill。

通用目录不保证所有产品都会自动发现。是否支持取决于具体宿主。

### Codex

```bash
personal-os --agent codex --yes
```

目标：

```text
~/.codex/skills/personal-os
```

### Claude Code

```bash
personal-os --agent claude --yes
```

目标：

```text
~/.claude/skills/personal-os
```

### WorkBuddy、QCode、Kimi 或其他 Agent

不同版本、发行渠道和产品可能使用不同目录。Personal OS 不猜测未确认的路径。

先从产品文档、设置或当前 Agent 获取它真实支持的 Skill 父目录，然后运行：

```bash
personal-os \
  --agent none \
  --skill-dir "/真实的/skills/父目录" \
  --yes
```

需要安装到多个明确目录时，重复 `--skill-dir`：

```bash
personal-os \
  --agent none \
  --skill-dir "/path/a" \
  --skill-dir "/path/b" \
  --yes
```

如果宿主不支持 Skill 目录，仍然可以安装 `pos` CLI，并让 Agent 在每次任务中显式读取已安装目录内的 `SKILL.md`。这不如原生 Skill 发现方便，但不会要求猜测系统路径。

## 自定义安装位置

```bash
personal-os \
  --data-dir "/custom/data/personal-os" \
  --bin-dir "/custom/bin" \
  --agent generic \
  --yes
```

也可以使用环境变量：

```text
PERSONAL_OS_DATA_DIR
PERSONAL_OS_BIN_DIR
XDG_DATA_HOME
```

## PATH 设置

如果安装结果提示 `~/.local/bin` 不在 `PATH`，把下面一行加入当前 Shell 配置：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

zsh 通常写入 `~/.zshrc`，bash 通常写入 `~/.bashrc`。修改后打开新终端并验证：

```bash
command -v pos
pos help
```

Agent 也可以先使用安装结果返回的绝对 CLI 路径完成验证，不应擅自修改 Shell 配置。

## 安装结果验证

```bash
pos help
personal-os --dry-run --json
```

同时检查对应 Skill 目标中存在：

```text
SKILL.md
AGENT_INSTALL.md
references/
assets/
scripts/
```

安装 Skill 后需要启动新的 Agent 会话，宿主才可能重新发现它。

## 冲突处理

安装器遵循“拒绝覆盖”原则：

- 现有 `pos` 是普通文件或无关链接：停止安装；
- Skill 目标是已有普通目录：停止安装；
- 版本目录存在但没有合法安装标记：停止安装；
- 已经是同一版本：复用；
- 链接指向受管理的旧 Personal OS 版本：可以安全更新链接并保留旧版本目录。

不要为了解决冲突直接删除文件。先检查现有内容，再选择其他 `--bin-dir` 或 `--skill-dir`。

## 创建第一个 Personal OS

安装完成后，不要让 Agent 自动扫描或接管已有目录。

先阅读[15 分钟首次运行](first-run.md)和[安全说明](safety.md)，选择一个全新或空目录，再执行：

```bash
pos init /absolute/path/to/new-personal-os \
  --areas "学习,工作"

pos doctor /absolute/path/to/new-personal-os
```

如果将来需要使用旧资料，先备份原目录，再由用户主动把少量选定文件复制到新 Personal OS 的 `00_Inbox`。v1.0 不提供全量迁移或原地整理功能。

## 卸载

安装器不会自动卸载或删除版本目录。手动卸载前，应先确认链接确实属于 Personal OS，不要使用宽泛的递归删除命令。

建议让 Agent：

1. 只检查安装结果中明确列出的 CLI 和 Skill 链接；
2. 预览将要移除的链接；
3. 保留版本目录，直到确认不再需要回滚；
4. 不触碰任何 Personal OS 数据根目录。
