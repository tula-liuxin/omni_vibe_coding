# Tools

这个目录放可以直接部署或执行的工具包、脚本集合、命令封装。

## 当前工具

### [`codex-tmux-bundle`](./codex-tmux-bundle)

作用：

- 在 tmux 中管理多个 Codex 账号
- 每个账号绑定自己的 `CODEX_HOME`
- 支持账号窗口、子代理 window、子代理 pane

部署：

- 目标环境建议是 Ubuntu / WSL / 其他 Linux shell 环境
- 进入 [`tools/codex-tmux-bundle`](./codex-tmux-bundle) 后运行 `install.sh`
- 详细步骤见 [`tools/codex-tmux-bundle/README.md`](./codex-tmux-bundle/README.md)

使用：

- 主入口：`tmux-codex`
- 账号相关：`codex-account-new`、`codex-account-limits`、`codex-account-logout`
- 代理相关：`codex-agent-window`、`codex-agent-pane`

## 添加新工具的约定

- 一个工具一个独立目录
- 工具目录内应有自己的 README
- README 至少写清楚：用途、依赖、部署、使用、平台限制
