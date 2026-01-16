# Codex 多账号 tmux 打包说明

## 作用
- 每个账号独立 `CODEX_HOME`，避免登录状态互相污染
- tmux session 自动用登录邮箱（@ 前缀）命名
- 一键恢复所有账号 session

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

- 一键恢复所有账号：
```bash
~/bin/tmux-codex
```
  - 如果当前终端不是交互式，会提示你用 `tmux attach -t <session名>` 手动进入
  - 只会自动进入第一个 session，其它账号的 session 会在后台启动
  - 查看所有 session：`tmux ls`
  - 进入指定账号：`tmux attach -t <session名>`

## 同账号多窗口
- 每个 tmux session 绑定一个独立的 Codex 账号
- 同一 session 的所有 window/pane 会强制使用同一账号（锁定 `CODEX_HOME`）
- 在同一 session 中尝试切换到其他账号会被阻止
- 同一个账号需要多个窗口/分屏时，在该 session 内操作：
  - 新窗口：`Ctrl-b` 然后 `c`
  - 水平分屏：`Ctrl-b` 然后 `"`
  - 垂直分屏：`Ctrl-b` 然后 `%`
  - 切换窗口：`Ctrl-b` 然后数字键（0/1/2...）

## 层级代理（session -> window -> pane）
- 规则
  - session = 顶层代理（账号级）
  - window = 子代理
  - pane = 更细的子代理
  - pane 会自动注入“我是谁/上级是谁”的提示词
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
  - 同步/重注入提示词：
    ```bash
    ~/bin/codex-agent-sync
    ```
    强制重发：`~/bin/codex-agent-sync --force`

## 常用 tmux 命令
- 列出所有 session：
  ```bash
  tmux ls
  ```
- 进入指定 session：
  ```bash
  tmux attach -t <session名>
  ```
- 强制接管已被占用的 session：
  ```bash
  tmux attach -d -t <session名>
  ```
- 退出当前 session（保留后台运行）：
  - `Ctrl-b` 然后 `d`

## 查询账号限额
- 输出所有账号的 5h / weekly 限额：
  ```bash
  ~/bin/codex-account-limits
  ```
- 说明：
  - 脚本会向每个账号的 codex pane 发送 `/status`
  - 需要对应 session 正在运行 codex

## 恢复与重启
- 只回到某个账号 session：
  ```bash
  tmux attach -t <session名>
  ```
  例：`tmux attach -t alice`
- WSL 重启后：
  - 运行 `tmux-codex` 一键重建/恢复所有账号 session
  - 如需恢复窗口布局，进入 tmux 后用 `Ctrl-b` + `r`（tmux-resurrect）

## 行为说明
- 通过 `account_id` 防止重复账号
- 如登录账号变化，会自动更新 session 和目录名
- 登录状态保存在 `~/.codex-accounts/accounts/<username>`
- 每个 session 会设置 `CODEX_HOME` 和 `CODEX_ACCOUNT`，新 window/pane 会继承
# omni_vibe_coding
