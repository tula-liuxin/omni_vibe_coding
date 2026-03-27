# Codex Tools

这里存放与 Codex 工作流直接相关的工具源码。

当前它只是 `tools/` 下的一个命名空间，不代表整个仓库只维护 Codex 工具。

## 当前条目

### [`codex-tmux-bundle/`](./codex-tmux-bundle/)

用途：

- 在 tmux 中组织多账号 Codex 工作流
- 管理账号窗口、代理窗口与代理 pane

入口与说明：

- [`README.md`](./codex-tmux-bundle/README.md)
- [`install.sh`](./codex-tmux-bundle/install.sh)

典型场景：

- Linux / WSL 下的多账号 Codex 工作流
- 需要为不同账号维持独立 `CODEX_HOME` 的终端环境
