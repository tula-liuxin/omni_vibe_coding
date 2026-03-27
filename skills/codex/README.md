# Codex Skills

这里存放“面向 Codex 本身或 Codex 周边维护流程”的 skill 源码。

它们属于仓库中的一个命名空间，而不是整个仓库的默认身份。
换句话说：仓库是通用资产库，`skills/codex/` 只是当前已经落地的一个命名空间。

## 当前条目

### [`codex-manager-maintainer/`](./codex-manager-maintainer/)

用途：

- 安装、修复、升级、迁移 `codex_m`
- 维护 `codex_m` 的官方身份切换与状态一致性

入口与关键资源：

- [`SKILL.md`](./codex-manager-maintainer/SKILL.md)
- [`scripts/detect_environment.js`](./codex-manager-maintainer/scripts/detect_environment.js)
- [`scripts/validate_codex_manager.js`](./codex-manager-maintainer/scripts/validate_codex_manager.js)
- [`scripts/install_windows.ps1`](./codex-manager-maintainer/scripts/install_windows.ps1)

## 使用与部署

仓库里的目录是源码目录。
如果要给本机 Codex 使用，通常把对应 skill 目录同步到：

- `~/.codex/skills/custom/<skill-name>/`

例如：

- `skills/codex/codex-manager-maintainer/` -> `~/.codex/skills/custom/codex-manager-maintainer/`

排障时如果改了部署副本，记得把修复同步回仓库源码。
