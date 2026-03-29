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

### [`codex-dual-provider-windows/`](./codex-dual-provider-windows/)

用途：

- 在 Windows 下隔离官方 `codex` 与第三方 `codex3`
- 维护 `codex3_m`、wrapper、第三方 provider 配置与 API key profile

入口与关键资源：

- [`SKILL.md`](./codex-dual-provider-windows/SKILL.md)
- [`scripts/validate_codex3_manager.js`](./codex-dual-provider-windows/scripts/validate_codex3_manager.js)
- [`scripts/install_windows.ps1`](./codex-dual-provider-windows/scripts/install_windows.ps1)
- [`references/troubleshooting.md`](./codex-dual-provider-windows/references/troubleshooting.md)

## 当前这套 Windows 方案里，谁负责什么

- `codex_m`
  管理官方身份。它切换的是普通 `codex.exe` 使用的官方 auth/config 载体，不会把整套 `~/.codex` 当成可任意替换的家目录。
- `codex3`
  是单独的第三方 wrapper 命令。它默认把第三方 auth 和 provider 镜像配置放在 `~/.codex-apikey`。
- `codex3_m`
  管理第三方 API key profile、provider 参数，以及“临时让 plain codex 跟随第三方”的桥接动作。
- `codex-manager-maintainer`
  是给 Codex agent 用的维护型 skill，对应 `codex_m` 这条官方链路。
- `codex-dual-provider-windows`
  是给 Codex agent 用的维护型 skill，对应 `codex3` 和 `codex3_m` 这条第三方链路。
- [`tools/codex/codex-tmux-bundle/`](../../tools/codex/codex-tmux-bundle/)
  是另一类工具，偏 Linux / WSL / tmux 多账号工作流，不是当前这条 Windows 双通道安装的必需品。

## 另一台 Windows 电脑最简单、最稳定的安装顺序

1. 先安装官方 `codex` CLI，并确认 `node`、`npm` 可用。
2. 把仓库检出到任意路径。当前机器示例是 `E:\leo\my_github\omni_vibe_coding`，另一台机器不需要复刻这个路径。
3. 把两个 skill 目录复制到 `~/.codex/skills/custom/`，让 Codex 后续会话也能直接加载它们。
4. 从部署后的 skill 目录运行两个 `install_windows.ps1`，分别安装 `codex_m` 和 `codex3_m` / `codex3`。
5. 用 `codex_m` 保存或导入官方身份，再用 `codex3_m` / `codex3` 保存第三方 provider 配置和 API key。
6. 需要让 plain `codex` 临时跟随第三方时，用 `codex3_m use-codex3`；需要恢复官方 plain `codex` 时，用 `codex_m use-codex`。

完整步骤、命令示例和校验清单见：

- [`windows-bootstrap.md`](./windows-bootstrap.md)

## 使用与部署

仓库里的目录是源码目录。
如果要给本机 Codex 使用，通常把对应 skill 目录同步到：

- `~/.codex/skills/custom/<skill-name>/`

例如：

- `skills/codex/codex-manager-maintainer/` -> `~/.codex/skills/custom/codex-manager-maintainer/`
- `skills/codex/codex-dual-provider-windows/` -> `~/.codex/skills/custom/codex-dual-provider-windows/`

补充说明：

- `scripts/install_windows.ps1` 默认会从“脚本自身所在目录”推导 `SkillRoot`，所以既可以从仓库源码目录运行，也可以从 `~/.codex/skills/custom/...` 里的部署副本运行。
- 如果目的是“另一台机器长期稳定使用”，更推荐先同步到 `~/.codex/skills/custom/...`，再从那里运行安装脚本。这样 Codex 读到的 skill 和你拿来安装的资源保持同一份副本。

排障时如果改了部署副本，记得把修复同步回仓库源码。

## 是否有必要把几个工具和 skill 合成一个？

默认不建议把这两个 skill、三个命令合成一个大一统条目。

原因很简单：

- 官方链路和第三方链路有不同的数据目录、不同的 guardrail、不同的故障模式。
- `codex_m` 解决的是“官方身份切换”，`codex3` 解决的是“第三方独立运行”，`codex3_m` 解决的是“第三方 profile 管理和 plain codex 桥接”，职责并不相同。
- 现在这套分层虽然看起来多一点，但边界清楚，出了问题也更容易定位到是官方 lane、第三方 lane，还是 plain `codex` bridge。

如果只是想降低新机部署成本，最简单、最稳定的做法不是合并 runtime，而是后续增加一个很薄的 bootstrap 入口，例如命名空间级别的 `install-windows-codex-stack.ps1`。它只负责：

- 同步两个 skill 到 `~/.codex/skills/custom/`
- 顺序调用两个 installer
- 打印下一步命令和验证命令

这样既能减少手工步骤，又不会打乱当前已经稳定的职责边界。
