# Windows Bootstrap

这份文档面向“另一台 Windows 电脑从零复用当前 Codex 相关资产”的场景。

范围包括：

- `codex_m`
- `codex3`
- `codex3_m`
- `codex-manager-maintainer`
- `codex-dual-provider-windows`

不包括：

- [`tools/codex/codex-tmux-bundle/`](../../tools/codex/codex-tmux-bundle/)
  这个工具偏 Linux / WSL / tmux 多账号工作流，不是当前这条 Windows 双通道方案的必需项。

## 1. 先分清四层路径

源码检出路径：

- 当前机器示例：`E:\leo\my_github\omni_vibe_coding`
- 另一台机器可以是任意路径，例如 `D:\workspace\omni_vibe_coding`

Codex 要读取的 skill 部署路径：

- `C:\Users\<you>\.codex\skills\custom\codex-manager-maintainer\`
- `C:\Users\<you>\.codex\skills\custom\codex-dual-provider-windows\`

运行时状态路径：

- 官方 Codex home：`C:\Users\<you>\.codex`
- 官方 manager home：`C:\Users\<you>\.codex-manager`
- 第三方 manager home：`C:\Users\<you>\.codex3-manager`
- 第三方 auth / provider home：`C:\Users\<you>\.codex-apikey`

launcher 路径：

- `%APPDATA%\npm\codex_m.ps1`
- `%APPDATA%\npm\codex3.ps1`
- `%APPDATA%\npm\codex3_m.ps1`

最重要的结论：

- 仓库检出路径不需要固定成 `E:\leo\my_github\omni_vibe_coding`。
- `install_windows.ps1` 默认从脚本所在目录推导 `SkillRoot`，所以它依赖的是“这份 skill 自己在哪里”，不是硬编码的仓库绝对路径。
- 如果你希望另一台机器长期稳定使用，最推荐的做法是先把 skill 同步到 `~/.codex/skills/custom/`，再从部署副本执行 installer。

## 2. 先决条件

在新机器上先确认这些前置条件：

- 官方 `codex` 命令已经安装，且能在 PowerShell 里运行。
- `node` 和 `npm` 在 `PATH` 中。
- `%APPDATA%\npm` 在 `PATH` 中，这样新装的 `codex_m`、`codex3`、`codex3_m` 才能直接调用。
- 可以使用 PowerShell 执行本仓库里的 `install_windows.ps1`。

如果只想靠复制文件而不是 git，也完全可以，不要求另一台机器一定安装 git。

## 3. 把 skill 复制到 Codex 自己会读取的位置

下面用一个新的仓库路径示例演示：

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
```

这样做的好处是：

- Codex 后续会话能直接读取这两个 skill。
- 你运行 installer 时，脚本和它依赖的 `assets/`、`references/` 都在同一份部署副本里。

## 4. 先安装官方链路，再安装第三方链路

推荐在新机器上按这个顺序执行：

```powershell
powershell -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\install_windows.ps1"

powershell -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-dual-provider-windows\scripts\install_windows.ps1"
```

这一步做完后，正常会得到：

- `codex_m`
- `codex3`
- `codex3_m`

它们的 launcher 默认位于 `%APPDATA%\npm`。

补充说明：

- 如果你只是临时测试，也可以直接从仓库源码目录运行这两个 installer。
- 但对“另一台机器长期使用”来说，更推荐从 `~/.codex/skills/custom/...` 里的部署副本运行，这样最不容易出现“Codex 读的是一份，installer 用的是另一份”的偏差。

## 5. 官方链路首次设置

`codex_m` 负责的是普通 `codex.exe` 的官方身份管理。

常见首次使用路径：

- 如果要新走一次官方 ChatGPT 登录，运行 `codex_m`，进入 `Login`，再选择 `Start ChatGPT login now`。
- 如果 `~/.codex/auth.json` 已经有官方登录，运行 `codex_m`，进入 `Login`，再选择 `Use current signed-in Codex`。
- 如果普通 `codex` 要走官方 API key 模式，运行 `codex_m`，进入 `Login`，再选择 `Add official API key now`。

这条链路主要会管理：

- `~/.codex/auth.json`
- `~/.codex/config.toml` 里的受管顶层 key
- `~/.codex-manager/` 下保存的官方快照

它不会把整个 `~/.codex` 当成一个可随意切换的整体家目录来替换。

## 6. 第三方链路首次设置

`codex3` 是独立的第三方运行命令，`codex3_m` 是它的 profile / provider 管理器。

推荐首次使用顺序：

1. 如果第三方 provider 教程参数和当前默认值不同，先更新 provider。
2. 再保存第三方 API key profile。
3. 最后验证 `codex3` 已经走第三方链路。

如果教程值需要覆盖默认值，可以先运行：

```powershell
codex3_m provider set `
  --command-name codex3 `
  --provider-name 'OpenAI' `
  --base-url 'https://example.com' `
  --model 'gpt-5.4' `
  --review-model 'gpt-5.4' `
  --model-reasoning-effort 'xhigh'
```

然后保存第三方 key。最简单的方式有两种：

- `codex3 login`
- `codex3_m login`

两者的区别：

- `codex3 login` 直接写入第三方 home 下的 `auth.json`
- `codex3_m login` 会把 key 保存成 manager 可管理的 profile，并能继续做切换、重命名、删除和 plain `codex` bridge

第三方链路主要会使用：

- `~/.codex-apikey/auth.json`
- `~/.codex-apikey/config.toml`
- `~/.codex3-manager/profiles/`

默认设计下，它不会去改写官方 `~/.codex` 的常规身份数据；只有你显式执行 plain `codex` bridge 时，才会临时影响普通 `codex` 的载体文件。

## 7. 什么时候该用 plain `codex`，什么时候该用 `codex3`

默认建议：

- 官方场景用 plain `codex`，并由 `codex_m` 管理官方身份。
- 第三方场景直接用 `codex3`。
- 只有在你明确想让 plain `codex` 临时跟随第三方时，才执行 `codex3_m use-codex3`。
- 想恢复官方 plain `codex` 时，执行 `codex_m use-codex`。

这样最不容易把“官方 lane”和“第三方 lane”混在一起。

## 8. 安装后验证

先检查命令是否存在：

```powershell
Get-Command codex,codex_m,codex3,codex3_m | Format-Table Name,Source,Path -AutoSize
```

再检查两个 manager 的本地状态：

```powershell
node "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\validate_codex_manager.js"
node "$HOME\.codex\skills\custom\codex-dual-provider-windows\scripts\validate_codex3_manager.js"

codex_m doctor
codex3_m doctor
```

最后做最直观的执行验证：

```powershell
codex exec --skip-git-repo-check "hello"
codex3 exec --skip-git-repo-check "hello"
```

期望是：

- plain `codex` 走官方链路
- `codex3` 走第三方链路
- `codex_m` 与 `codex3_m` 的 launcher 都已经落到 `%APPDATA%\npm`

如果你主动做过 `codex3_m use-codex3`，那 plain `codex` 暂时走第三方链路是正常现象；恢复时执行 `codex_m use-codex`。

## 9. 后续升级或修复

另一台机器上的长期维护，建议固定成这个动作顺序：

1. 更新仓库源码目录。
2. 把变更后的 skill 目录重新同步到 `~/.codex/skills/custom/`。
3. 重新运行两个 `install_windows.ps1`。
4. 重新跑验证命令。

这样能避免“源码已经更新，但机器上实际被 Codex 读取的 skill 还是旧副本”的状态漂移。

## 10. 是否要把几个工具和 skill 合并成一个

默认建议：不合并 runtime，不合并这两个维护型 skill。

原因：

- `codex_m` 管的是官方 auth/config 载体。
- `codex3` 管的是第三方独立运行入口。
- `codex3_m` 管的是第三方 profile、provider 参数和 plain `codex` bridge。
- `codex-manager-maintainer` 与 `codex-dual-provider-windows` 虽然都服务 Codex，但 guardrail 和 workflow 不同，分开更清楚，也更不容易误改另一条链路。

如果你只是想把“新电脑部署步骤”再简化一层，推荐做法不是合并已有 runtime，而是新增一个很薄的 bootstrap 入口，例如：

- `skills/codex/install-windows-codex-stack.ps1`

这个薄入口只做三件事：

- 同步两个 skill 到 `~/.codex/skills/custom/`
- 依次调用两个现有 installer
- 打印下一步初始化命令和验证命令

这样改动最小，稳定性最好，也不会破坏当前已经验证过的职责边界。
