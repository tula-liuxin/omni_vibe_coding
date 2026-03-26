# Skills

这个目录放给 Codex 使用的 skill。

和普通工具不同，skill 的核心文件是 `SKILL.md`。  
如果需要给人看索引、部署方式、仓库级说明，优先写在这个分类 README，而不是在每个 skill 目录里额外堆很多用户文档。

## 当前 Skills

### [`codex-manager-maintainer`](./codex-manager-maintainer)

作用：

- 安装、修复、升级、迁移 `codex_m`
- 维持 `codex_m` 的稳定交互契约：
  - Home = `Login / Manage / Quit`
  - `Login now` 为主登录路径
  - 登录成功后要求手动输入 workspace 名称
  - `Manage` 只管理真实登录快照
- 避免把 `organizations[].id` 误当作真实可切换 workspace

部署：

1. 将整个 [`skills/codex-manager-maintainer`](./codex-manager-maintainer) 目录复制到目标机器的 `~/.codex/skills/custom/`
2. 或者把它作为仓库内 skill 源，再由 Codex/脚本同步到 `~/.codex/skills/custom/`

使用：

- 在 Codex 中明确触发：`$codex-manager-maintainer`
- 适用场景：
  - 新机器上安装 `codex_m`
  - 现有 `codex_m` 损坏后的修复
  - Codex CLI 更新后的升级/适配
  - 跨机器迁移 `codex_m` 能力

主要文件：

- Skill 入口：[`skills/codex-manager-maintainer/SKILL.md`](./codex-manager-maintainer/SKILL.md)
- Windows 安装脚本：[`skills/codex-manager-maintainer/scripts/install_windows.ps1`](./codex-manager-maintainer/scripts/install_windows.ps1)
- 环境检测：[`skills/codex-manager-maintainer/scripts/detect_environment.js`](./codex-manager-maintainer/scripts/detect_environment.js)
- 自检脚本：[`skills/codex-manager-maintainer/scripts/validate_codex_manager.js`](./codex-manager-maintainer/scripts/validate_codex_manager.js)

平台说明：

- Windows 11：当前有完整基线实现
- Ubuntu / macOS：当前不预制完整实现；未来由目标机器上的 Codex 依据共用契约和当前环境补齐平台适配

## 添加新 Skill 的约定

- 一个 skill 一个独立目录
- skill 目录必须有 `SKILL.md`
- 如果 skill 带脚本、引用文档、资源文件，按 `scripts/`、`references/`、`assets/` 分开
- 平台特定细节要隔离，避免互相污染
