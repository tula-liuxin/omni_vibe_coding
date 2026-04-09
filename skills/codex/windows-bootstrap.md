# Windows Bootstrap

这份文档面向“另一台 Windows 电脑从零复用当前 Codex 相关资产”的场景。

覆盖范围：

- `codex_m`
- `codex3`
- `codex3_m`
- `codex-manager-maintainer`
- `codex-dual-provider-windows`

不包含：

- [`tools/codex/codex-tmux-bundle/`](../../tools/codex/codex-tmux-bundle/)

## 1. 先分清四层路径

仓库 source 路径：

- 当前机器示例：`E:\leo\my_github\omni_vibe_coding`
- 另一台机器可以放在任意路径，例如 `D:\workspace\omni_vibe_coding`

Codex 读取的 skill 部署路径：

- `C:\Users\<you>\.codex\skills\custom\codex-manager-maintainer\`
- `C:\Users\<you>\.codex\skills\custom\codex-dual-provider-windows\`
- `C:\Users\<you>\.codex\skills\custom\_internal-codex-windows-core\`

运行时状态路径：

- Desktop home：`C:\Users\<you>\.codex`
- 官方 CLI home：`C:\Users\<you>\.codex-official`
- 官方 manager home：`C:\Users\<you>\.codex-manager`
- 第三方 manager home：`C:\Users\<you>\.codex3-manager`
- 第三方 home：`C:\Users\<you>\.codex-apikey`

launcher 路径：

- `%APPDATA%\npm\codex.ps1`
- `%APPDATA%\npm\codex_m.ps1`
- `%APPDATA%\npm\codex3.ps1`
- `%APPDATA%\npm\codex3_m.ps1`

最重要的结论：

- 仓库检出路径不需要固定成 `E:\leo\my_github\omni_vibe_coding`
- 真正被 Codex 读取的是 `~/.codex/skills/custom/...` 下的部署副本
- 真正运行时依赖的是用户目录下的 `~/.codex*` 和 `%APPDATA%\npm`

## 2. 前置条件

在新机器上先确认：

- 官方 `codex` CLI 已可用
- `node` 与 `npm` 已在 `PATH`
- `%APPDATA%\npm` 已在 `PATH`
- PowerShell 可以执行仓库中的 `install_windows.ps1`

## 3. 先把 skill 同步到 Codex 自己会读的位置

```powershell
$repo = 'D:\workspace\omni_vibe_coding'
$skillRoot = Join-Path $HOME '.codex\skills\custom'

New-Item -ItemType Directory -Force -Path $skillRoot | Out-Null

Copy-Item -Recurse -Force `
  (Join-Path $repo 'skills\codex\codex-manager-maintainer') `
  (Join-Path $skillRoot 'codex-manager-maintainer')

Copy-Item -Recurse -Force `
  (Join-Path $repo 'skills\codex\codex-dual-provider-windows') `
  (Join-Path $skillRoot 'codex-dual-provider-windows')

Copy-Item -Recurse -Force `
  (Join-Path $repo 'skills\codex\_internal-codex-windows-core') `
  (Join-Path $skillRoot '_internal-codex-windows-core')
```

推荐先同步再安装，这样能避免“Codex 读的是一份，installer 用的是另一份”。

## 4. 先安装官方链路，再安装第三方链路

```powershell
powershell -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\install_windows.ps1"

powershell -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-dual-provider-windows\scripts\install_windows.ps1"
```

做完后，正常会得到：

- `codex_m`
- `codex3`
- `codex3_m`

## 5. 官方链路初始化

`codex_m` 负责官方身份和 Desktop 官方跟随。

常见入口：

- 新做一次官方 ChatGPT 登录：运行 `codex_m`，进入 `Login`
- 导入当前官方登录：运行 `codex_m`，进入 `Login`，选择导入当前官方身份
- 保存官方 API key：运行 `codex_m`，进入 `Login`，选择添加官方 API key

## 6. 第三方链路初始化

当前稳定第三方方案固定为：

- provider id：`api111`
- base URL：`https://api.xcode.best/v1`
- auth method：`apikey`
- 默认模型：`gpt-5-codex`
- reasoning：`high`

最常见用法：

- `codex3 login`
- 或 `codex3_m login`

两者差别：

- `codex3 login` 直接写入第三方 home 下的 `auth.json`
- `codex3_m login` 会把 key 保存为可管理 profile，后续可切换、重命名、删除，并可驱动 Desktop 跟随第三方

## 7. 谁该用哪条链路

默认建议：

- 官方场景用 plain `codex`
- 第三方场景用 `codex3`
- 只在明确需要让 Desktop `codex.exe` 跟随第三方时，执行 `codex3_m use-codex3`
- 想恢复 Desktop 官方模式时，执行 `codex_m use-codex`

当前 Desktop bridge 的稳定规则是：

- 官方模式：`~/.codex-official` 直接镜像到 `~/.codex`
- 第三方模式：`~/.codex-apikey` 直接镜像到 `~/.codex`

不再依赖旧的备份快照链路。

## 8. 安装后验证

先检查命令是否存在：

```powershell
Get-Command codex,codex_m,codex3,codex3_m | Format-Table Name,Source,Path -AutoSize
```

再检查两个 manager 的状态：

```powershell
node "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\validate_codex_manager.js"
node "$HOME\.codex\skills\custom\codex-dual-provider-windows\scripts\validate_codex3_manager.js"

codex_m doctor
codex3_m doctor
```

最后做执行验证：

```powershell
codex exec --skip-git-repo-check "hello"
codex3 exec --skip-git-repo-check "hello"
```

期望结果：

- plain `codex` 走官方链路
- `codex3` 走第三方链路
- `codex_m` 与 `codex3_m` 的 launcher 都已落到 `%APPDATA%\npm`

## 9. 升级或修复时的顺序

推荐固定按这个顺序做：

1. 更新仓库 source
2. 把变更后的 skill 重新同步到 `~/.codex/skills/custom/`
3. 重新运行两个 `install_windows.ps1`
4. 重新跑 validator 和 smoke test

这样最不容易出现 source 与 deployment 漂移。
