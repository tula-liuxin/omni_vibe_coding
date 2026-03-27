# Repository Guidelines

## 仓库定位

本仓库是一个通用资产库，用来集中维护可复用的：

- `skills`
- `tools`
- `mcp`
- 以及它们各自的安装、验证、迁移和说明文档

它不是 `~/.codex` 的镜像，也不是“只给 Codex 用”的仓库。
当前刚好有一批 Codex 相关资产，所以在分类目录下使用 `codex/` 作为命名空间隔离它们。

## 目录结构与命名空间

采用“分类 + 命名空间 + 条目”的三层组织方式：

```text
skills/<namespace>/<skill-name>/
tools/<namespace>/<tool-name>/
mcp/<family>/<entry-name>/
```

当前已落地的结构：

- `skills/codex/`
  放当前面向 Codex 的 skill 源码，例如：
  - `skills/codex/codex-manager-maintainer/`
- `tools/codex/`
  放当前与 Codex 工作流直接相关的工具，例如：
  - `tools/codex/codex-tmux-bundle/`
- `mcp/`
  预留给 MCP 相关资产，并按家族拆分：
  - `mcp/servers/`
  - `mcp/connectors/`
  - `mcp/templates/`

新增内容不要直接堆在 `skills/`、`tools/`、`mcp/` 根下，优先先建好命名空间或 family，再放具体条目。

## Source 与 Deployment 的边界

仓库里保存的是“源码和维护入口”，不是机器本地部署结果。

例如下面这些都属于部署态，不应被当成仓库结构的一部分：

- `~/.codex/skills/custom/...`
- `~/.codex-manager/...`
- `~/.codex3-manager/...`
- `%APPDATA%\npm\codex_m.ps1`
- `%APPDATA%\npm\codex3.ps1`

如果为了排障临时修改了本机部署副本，结束前要把修复同步回仓库中的源目录，再以仓库内容为准。

## 文档约定

- 根目录 `README.md` 负责解释仓库定位、总览与导航。
- 分类目录 `skills/`、`tools/`、`mcp/` 各自维护分类索引 `README.md`。
- 命名空间目录也应有自己的 `README.md`，用于说明该命名空间下有哪些条目、面向谁、怎么部署。
- 具体条目：
  - tool 目录必须有 `README.md`
  - skill 目录必须有 `SKILL.md`
  - MCP 条目目录必须有最少一份能说明用途、依赖、部署和接入方式的 `README.md`

不要把给人看的总览说明散落到每个 skill 目录里；skill 目录内优先保留给 Codex 使用的 `SKILL.md` 及必要资源。

## 构建、测试与开发命令

仓库目前没有统一根级构建入口，按条目执行：

```bash
./tools/codex/codex-tmux-bundle/install.sh

node skills/codex/codex-manager-maintainer/scripts/detect_environment.js
node skills/codex/codex-manager-maintainer/scripts/validate_codex_manager.js
cd skills/codex/codex-manager-maintainer/assets/windows-runtime && npm install
```

命令含义：

- `install.sh`
  安装 `codex-tmux-bundle`
- `detect_environment.js`
  采集当前平台与 Codex 相关环境
- `validate_codex_manager.js`
  校验 `codex_m` 的安装、状态和官方身份切换一致性
- `npm install`
  仅在修改对应 runtime 依赖时使用

## 编码风格与命名约定

- 默认使用 UTF-8。
- 仓库中的自然语言说明优先使用中文；只有协议字段、命令名、上游固定术语等场景保留英文。
- 目录名使用短横线风格。
- skill 入口固定为 `SKILL.md`。
- tool 与 MCP 条目的人类说明优先使用 `README.md`。
- 平台相关实现必须隔离，避免把 Windows、Linux、macOS 细节混写在一段逻辑里。

## 测试指南

当前没有统一测试框架，提交前至少做对应条目的冒烟验证：

- 修改 `skills/codex/codex-manager-maintainer/`
  运行环境检测与校验脚本
- 修改 `tools/codex/codex-tmux-bundle/`
  至少检查安装流程、关键命令入口与 README 示例是否一致
- 修改 `mcp/`
  把启动、接入、验证步骤写入对应 family/entry 的 README

如果新增了可自动化验证，请把命令写入该条目的 README 或分类索引。

## 提交与合并请求规范

历史里同时存在 `fix(...)`、`feat(...)` 和较早期的 `updated`。后续统一使用：

```text
type(scope): summary
```

例如：

- `fix(codex-manager): preserve active official profile`
- `docs(repo): introduce namespace-based asset layout`
- `feat(codex3): probe provider balance failures in doctor`

PR 说明至少包含：

- 变更目的
- 影响目录
- 验证步骤
- 若涉及交互流程、终端命令或 UI，附示例输出或截图

## 贡献约定

- 新增条目前，先判断它属于哪一类：`skills`、`tools` 还是 `mcp`。
- 再判断它属于哪个命名空间或 family，而不是直接放到分类根目录。
- 新增、迁移、删除条目后，要同步更新：
  - 根 `README.md`
  - 对应分类 `README.md`
  - 对应命名空间或 family 的 `README.md`
- 如果某个条目既有“仓库源码目录”又有“机器部署目录”，文档里必须明确两者的区别。
