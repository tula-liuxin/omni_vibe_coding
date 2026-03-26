# omni_vibe_coding

这个仓库用来集中保存我自己常用但比较零散的东西，重点包括：

- `tools/`：脚本、打包工具、可直接部署的命令集合
- `skills/`：给 Codex 用的 skill
- `mcp/`：MCP 服务、配置、适配层和相关说明

仓库目标不是“大而全”，而是把每一类东西的目录、部署方式、使用入口和文档关系整理清楚，方便以后持续追加。

## 目录总览

| 分类 | 目录 | 说明 | 索引文档 |
| --- | --- | --- | --- |
| Tools | [`tools/`](./tools) | 可执行工具、脚本包、命令集合 | [`tools/README.md`](./tools/README.md) |
| Skills | [`skills/`](./skills) | Codex 可直接使用的 skill | [`skills/README.md`](./skills/README.md) |
| MCP | [`mcp/`](./mcp) | MCP 服务与配置占位/索引 | [`mcp/README.md`](./mcp/README.md) |

## 当前内容

| 分类 | 名称 | 作用 | 部署 | 使用 | 文档 |
| --- | --- | --- | --- | --- | --- |
| Tools | [`codex-tmux-bundle`](./tools/codex-tmux-bundle) | 多账号 tmux + Codex 工作流打包 | 在目标 Linux/WSL 环境运行 `install.sh` | 用 `tmux-codex`、`codex-account-*`、`codex-agent-*` 管理多账号/多代理 | [`tools/codex-tmux-bundle/README.md`](./tools/codex-tmux-bundle/README.md) |
| Skills | [`codex-manager-maintainer`](./skills/codex-manager-maintainer) | 安装、修复、升级、迁移 `codex_m`，并保持 `Login / Manage / Quit` 与真实登录快照模型一致 | 拷贝到 Codex 的 `~/.codex/skills/custom/` 下，或按需引用其中脚本/资源 | 在 Codex 中触发 `$codex-manager-maintainer` 来安装、修复或升级 `codex_m` | [`skills/README.md`](./skills/README.md) / [`skills/codex-manager-maintainer/SKILL.md`](./skills/codex-manager-maintainer/SKILL.md) |
| MCP | 暂无实例 | 预留给未来的 MCP server / connector / adapter | 后续补充 | 后续补充 | [`mcp/README.md`](./mcp/README.md) |

## 维护约定

- 每个工具、skill、MCP 都应该有明确的归类目录，不直接散落在仓库根目录。
- 每个条目至少要能回答 3 件事：它是什么、怎么部署、怎么使用。
- `tools/` 下的条目应自带自己的 README。
- `skills/` 下的条目以 `SKILL.md` 为核心；如果需要给人看索引或部署说明，放在上一级分类 README，而不是往 skill 目录里堆额外用户文档。
- 平台相关实现要隔离，避免把 Windows、Linux、macOS 的细节混在一起。

## 推荐查看顺序

1. 先看根目录这个 README，知道仓库里有什么。
2. 再按分类看 [`tools/README.md`](./tools/README.md)、[`skills/README.md`](./skills/README.md)、[`mcp/README.md`](./mcp/README.md)。
3. 最后进入具体条目的 README 或 `SKILL.md` 看部署与使用细节。
