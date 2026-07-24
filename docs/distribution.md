# 弱网、国内网络与离线安装

`npx --package=github:...` 会在 Personal OS 安装器启动前获取 Git 仓库。若此阶段收到 `137 / SIGKILL`，只能说明获取进程被宿主、操作系统或资源限制终止；仅凭该结果不能断言一定是代理网络问题。

常见原因包括：

- Agent 对单条命令设置了较短的执行时间；
- GitHub 链路慢或不稳定；
- Agent 沙箱内存不足，进程被系统回收；
- npm / Git 缓存权限异常；
- 宿主不允许长时间联网子进程。

## 分发优先级

推荐按下面顺序选择，不把 GitHub 冷启动作为唯一入口：

1. **Release `.tgz`**：体积小，有 SHA-256，可直接交给 Agent；
2. **npm 包**：正式发布后允许用户选择官方 registry 或可信镜像；
3. **浅克隆 / GitHub 源码**：适合网络正常且命令时限充足的环境；
4. **离线文件**：把 `.tgz` 复制到目标电脑，由 Agent 本地安装。

## 制作发布包

维护者运行：

```bash
npm run release:bundle -- --output dist
```

输出：

```text
dist/
├── personal-os-<version>.tgz
├── release-manifest.json
└── SHA256SUMS
```

发布包预算小于 1 MiB，不包含 README 配图源文件、候选视觉稿、测试、Git 历史、个人数据、私有 Spec 或内部任务记录。

## 离线或聊天附件安装

用户把 `.tgz` 下载或通过聊天附件交给 Agent 后，Agent 先核对 `SHA256SUMS`，再执行：

```bash
npx --yes --package=./personal-os-<version>.tgz personal-os setup \
  --agent auto --install-only --yes --json
```

软件安装完成后，Agent 在下一轮对话中继续询问“新建一套”还是“整理已有目录”。这样避免联网安装与数据初始化占用同一条长命令。

## 国内镜像原则

- npm 发布后可用 `npm_config_registry=<可信镜像>` 指定 registry；
- 镜像命令只能在对应包已经真实同步后公开，不能发布一个尚不可用的示例；
- GitHub Release、npm 官方源、国内镜像与离线包应发布同一个 SHA-256 对应的内容；
- 不使用来历不明的 GitHub 代理域名作为默认安装源；
- 每个渠道都必须保留版本号、校验和、许可证与来源信息。

## Agent 执行建议

非交互式 Agent 不应运行完整交互 Setup。默认分两步：

1. 安装软件：

   ```bash
   personal-os setup --agent auto --install-only --yes --json
   ```

2. 新开会话或下一轮对话，再选择 Personal OS 数据路径并单独授权初始化/审计。

若宿主依旧终止安装，Agent 应报告：终止阶段、退出码、已用时间、可用内存、Node/npm/Git 版本和是否产生任何文件；不要直接把 `SIGKILL` 归因于网络。
