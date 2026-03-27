# Repository Guidelines

## 项目结构与模块组织
本仓库用于集中维护 Codex 相关资产，按类别分层组织。`tools/` 放可直接部署或执行的工具，当前重点是 `tools/codex-tmux-bundle/`；`skills/` 放可被 Codex 直接调用的技能，每个技能目录必须包含 `SKILL.md`，当前核心条目为 `skills/codex-manager-maintainer/`；`mcp/` 预留给 MCP 服务、连接器与配置说明。新增内容不要散落在根目录，需放入对应分类并补齐说明文档。

## 构建、测试与开发命令
仓库目前没有统一的根级构建入口，命令按模块执行：

```bash
./tools/codex-tmux-bundle/install.sh
node skills/codex-manager-maintainer/scripts/detect_environment.js
node skills/codex-manager-maintainer/scripts/validate_codex_manager.js
cd skills/codex-manager-maintainer/assets/windows-runtime && npm install
```

`install.sh` 用于安装 tmux 工具包；`detect_environment.js` 用于采集当前平台环境；`validate_codex_manager.js` 用于检查 `codex_m` 安装与快照状态；`npm install` 仅在修改 `windows-runtime` 依赖时使用。

## 编码风格与命名约定
默认使用 UTF-8，并尽量使用中文撰写仓库内自然语言内容；仅在协议字段、命令名或上游要求下保留英文。脚本与文档保持现有风格：JavaScript 使用清晰的描述性文件名，PowerShell 脚本使用动词开头，Shell 命令保持可复制执行。目录命名优先短横线风格，如 `codex-tmux-bundle`；技能入口固定为 `SKILL.md`；说明文档统一为 `README.md`。

## 测试指南
当前没有统一测试框架，提交前至少做对应模块的冒烟验证。修改 `codex-manager-maintainer` 时，运行环境检测与校验脚本；修改 `tools/codex-tmux-bundle` 时，至少检查安装流程、关键命令入口与 README 示例是否一致。若新增可自动化验证，请把命令写入模块 README。

## 提交与合并请求规范
Git 历史同时存在 `fix(codex-bundle): ...`、`feat(...)` 和较早期的 `updated`。后续提交建议采用“类型(范围): 摘要”格式，例如 `fix(codex-manager): preserve snapshot identity`，避免继续使用含义不明的 `updated`。PR 应说明变更目的、影响目录、验证步骤；若改动交互流程、终端命令或 UI，附示例输出或截图。

## 贡献约定
新增工具、技能或 MCP 条目时，必须同步补充各自目录下的说明文件，并保持平台相关实现隔离，不要把 Windows、Linux、macOS 的细节混写在同一段逻辑中。
