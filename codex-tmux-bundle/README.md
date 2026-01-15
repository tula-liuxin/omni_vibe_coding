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

## 同账号多窗口
- 每个 tmux session 绑定一个独立的 Codex 账号
- 同一个账号需要多个窗口/分屏时，在该 session 内操作：
  - 新窗口：`Ctrl-b` 然后 `c`
  - 水平分屏：`Ctrl-b` 然后 `"`
  - 垂直分屏：`Ctrl-b` 然后 `%`
  - 切换窗口：`Ctrl-b` 然后数字键（0/1/2...）

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
# omni_vibe_coding
