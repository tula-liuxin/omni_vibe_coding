# Codex Skills

这里存放的是与 Codex 本身及其 Windows 双链路维护相关的 skill 源码。
这些目录是仓库里的 source，不是某台机器上已经安装完成后的运行副本。

## 当前条目

### [`codex-manager-maintainer/`](./codex-manager-maintainer/)

用途：

- 安装、修复、升级、解释 `codex_m`
- 维护官方 `codex` / `codex.exe` 所使用的官方身份链路

关键入口：

- [`SKILL.md`](./codex-manager-maintainer/SKILL.md)
- [`scripts/detect_environment.js`](./codex-manager-maintainer/scripts/detect_environment.js)
- [`scripts/validate_codex_manager.js`](./codex-manager-maintainer/scripts/validate_codex_manager.js)
- [`scripts/install_windows.ps1`](./codex-manager-maintainer/scripts/install_windows.ps1)

### [`codex-dual-provider-windows/`](./codex-dual-provider-windows/)

用途：

- 维护 Windows 下官方 `codex` 与第三方 `codex3` 的隔离并存
- 维护 `codex3_m`、`codex3` wrapper、第三方 API key profile 与 Desktop 跟随切换

关键入口：

- [`SKILL.md`](./codex-dual-provider-windows/SKILL.md)
- [`scripts/install_windows.ps1`](./codex-dual-provider-windows/scripts/install_windows.ps1)
- [`scripts/install_codex3_wrapper.ps1`](./codex-dual-provider-windows/scripts/install_codex3_wrapper.ps1)
- [`scripts/validate_codex3_manager.js`](./codex-dual-provider-windows/scripts/validate_codex3_manager.js)

### [`_internal-codex-windows-core/`](./_internal-codex-windows-core/)

用途：

- 给上面两套 Windows skill 提供共享 runtime 与安装/校验辅助脚本
- 把 Desktop 镜像、plain `codex` 模式状态、线程元数据同步等公共逻辑放在一处维护

说明：

- 这是内部实现目录，不是面向最终用户直接调用的独立 skill
- 修改官方或第三方 Windows skill 时，常常也需要同步检查这里

## 当前 Windows 方案的职责边界

- `codex_m`
  负责官方身份管理，以及让 Desktop `codex.exe` 跟随官方链路。
- `codex3`
  是固定的第三方命令，运行在独立的 `~/.codex-apikey` 下。
- `codex3_m`
  负责第三方 API key profile、第三方配置，以及让 Desktop `codex.exe` 跟随第三方链路。

当前稳定约定是：

- plain `codex` 始终走官方链路
- `codex3` 始终走第三方链路
- Desktop `codex.exe` 通过模式切换决定跟随官方还是第三方
- Desktop bridge 不再依赖旧的备份快照，而是直接从真实源头镜像：
  - 官方模式：`~/.codex-official` -> `~/.codex`
  - 第三方模式：`~/.codex-apikey` -> `~/.codex`

## Shared Substrate 速记

当前 Windows 双链路不是“一套配置文件只换 auth”，而是“共享 substrate + lane 专属 auth/provider 配置”。

默认共享到 `%USERPROFILE%\.codex-shared` 的是：

- `sessions`
- `archived_sessions`
- `skills`
- `memories`
- `rules`
- `vendor_imports`
- `session_index.jsonl`
- `.codex-shared\config` 下的 shared MCP/MCP OAuth/project config fragments

默认不共享的是：

- 官方与第三方 auth carriers
- `model_provider` / `[model_providers.*]` 这类 lane-owned provider sections
- managed top-level provider/auth keys
- lane homes 本身，例如 `~/.codex-official`、`~/.codex-apikey`
- SQLite sidebar/thread 数据库，例如 `state_5.sqlite*`

唯一例外是 Desktop follow-mode bridge：

- `codex.exe` 可以显式跟随官方或第三方 lane
- 这属于 bridge 行为，不属于 substrate 的默认共享

## 安装与部署

仓库里的目录是 source。真正给本机 Codex 使用时，通常会把这些目录同步到：

- `~/.codex/skills/custom/codex-manager-maintainer/`
- `~/.codex/skills/custom/codex-dual-provider-windows/`
- `~/.codex/skills/custom/_internal-codex-windows-core/`

然后再从部署后的目录运行各自的 `install_windows.ps1`。

更完整的 Windows 安装顺序、验证方式和排障建议见：

- [`windows-bootstrap.md`](./windows-bootstrap.md)
