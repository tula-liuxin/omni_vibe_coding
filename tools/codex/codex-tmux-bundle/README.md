# Codex 多账号 tmux 打包说明

## 作用
- 每个账号独立 `CODEX_HOME`，避免登录状态互相污染
- tmux window 用登录邮箱命名（`.` 会被渲染为 `_`）
- 一键恢复所有账号 window 到 `agent_account`

## 包含内容
- `.tmux.conf`
- `codex-accounts/bin/` 下的账号管理脚本
- `bin/` 下的快捷命令
- `install.sh` 一键安装脚本

## 在新机器上安装
1) 安装依赖
```bash
sudo apt update
sudo apt install -y tmux git
```

2) 安装 TPM（tmux 插件管理器）
```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

3) 运行安装脚本（在本包目录里）
```bash
./install.sh
```

4) 进入 tmux 安装插件
- 进入 tmux 后按 `Ctrl-b` 再按 `I`

5) 确保 `~/bin` 在 PATH
```bash
export PATH="$HOME/bin:$PATH"
```
建议把上面这一行放到 `~/.bashrc`。

## 使用方法
- 添加账号（首次登录）：
```bash
~/bin/codex-account-new
```
  - 如果当前终端不是交互式，会提示你用 `tmux attach -t setup-XXXX` 进入登录界面

- 默认启动命令：
  - `codex --search --sandbox danger-full-access -c model_reasoning_effort=xhigh`

- 一键恢复所有账号（对齐到 `agent_account`）：
```bash
~/bin/tmux-codex
```
  - 如果当前终端不是交互式，会提示你用 `tmux attach -t agent_account` 手动进入
  - 只会启动/切换到 `agent_account`
  - 查看所有 session：`tmux ls`（应只保留 `agent_account`）
  - 切到指定账号：
    ```bash
    tmux attach -t agent_account
    tmux select-window -t agent_account:<window名>
    ```
  - 可选：设置启动目录（新建 window 的默认 cwd）
    ```bash
    CODEX_START_DIR=/mnt/c/Users/23677/agencyarche ~/bin/tmux-codex
    ```

## 同账号多窗口
- 所有账号共用一个 tmux session：`agent_account`
- 每个账号对应一个 window（window 绑定 `CODEX_HOME`/`CODEX_ACCOUNT`）
- 同一个账号需要多个窗口/分屏时，在该 window 内操作：
  - 新窗口：`Ctrl-b` 然后 `c`
  - 水平分屏：`Ctrl-b` 然后 `"`
  - 垂直分屏：`Ctrl-b` 然后 `%`
  - 切换窗口：`Ctrl-b` 然后数字键（0/1/2...）

## 层级代理（session -> window -> pane）
- 规则
  - session = 顶层代理（统一 `agent_account`）
  - window = 账号级代理
  - pane = 更细的子代理
  - 注意：pane 必须在某个 session 的 window 里创建（不在 tmux 内会提示 Run inside tmux）
  - 约定：window 的 pane 0 视为该 window 代理；session 的 window 0 / pane 0 视为 session 代理
- 快捷命令
  - 新建子代理 window 并启动 codex：
    ```bash
    ~/bin/codex-agent-window
    ```
    可指定名称：`~/bin/codex-agent-window A-1`
  - 新建子代理 pane 并启动 codex：
    ```bash
    ~/bin/codex-agent-pane v
    ```
    `v`=上下分屏，`h`=左右分屏

## 常用 tmux 命令
- 列出所有 session：
  ```bash
  tmux ls
  ```
- 进入指定 session：
  ```bash
  tmux attach -t agent_account
  ```
- 强制接管已被占用的 session：
  ```bash
  tmux attach -d -t agent_account
  ```
- 退出当前 session（保留后台运行）：
  - `Ctrl-b` 然后 `d`

## 鼠标与选择
- 开启鼠标支持（拖选会限制在 pane 内）：
  - `~/.tmux.conf` 加：
    ```bash
    set -g mouse on
    setw -g mode-keys vi
    ```
- 注意：按住 `Shift` 拖选会被终端接管，仍可能跨 pane；需用 tmux 复制模式或不按 `Shift`。

## 查询账号限额
- 输出所有账号的 5h / weekly 限额：
  ```bash
  ~/bin/codex-account-limits
  ```
- 说明：
  - 脚本会向 `agent_account` 中每个账号的 codex pane 发送 `/status`
  - 需要对应 window 正在运行 codex

## 恢复与重启
- 回到 `agent_account`：
  ```bash
  tmux attach -t agent_account
  ```
- WSL 重启后：
  - 运行 `tmux-codex` 一键重建/恢复所有账号 window
  - 如需恢复窗口布局，进入 tmux 后用 `Ctrl-b` + `r`（tmux-resurrect）

## 行为说明
- 通过 `account_id` 防止重复账号
- 如登录账号变化，会自动更新 window 和目录名
- 登录状态保存在 `~/.codex-accounts/accounts/<username>`
- 每个 window 会设置 `CODEX_HOME` 和 `CODEX_ACCOUNT`

## 项目开发流程（示例：/mnt/c/Users/23677/agencyarche）
1) 启动所有账号 window：
```bash
~/bin/tmux-codex
```
2) 进入 `agent_account` 并切换到目标账号 window：
```bash
tmux attach -t agent_account
tmux select-window -t agent_account:<window名>
```
3) 在主 pane 进入项目目录并启动 codex：
```bash
cd /mnt/c/Users/23677/agencyarche
codex
```
4) 创建子代理：
```bash
~/bin/codex-agent-window
~/bin/codex-agent-pane v
```

## 更新 Codex 版本（WSL）
- 使用用户级 npm prefix 避免 EACCES：
  ```bash
  export NPM_CONFIG_PREFIX="$HOME/.npm-global"
  export PATH="$HOME/.npm-global/bin:$PATH"
  ```
- 更新后重启 tmux pane 以生效：
  ```bash
  npm install -g @openai/codex
  ~/bin/codex-tmux-refresh
  ```
