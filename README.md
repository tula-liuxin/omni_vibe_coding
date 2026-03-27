# omni_vibe_coding

这是一个通用资产库，用来集中维护可复用的 skill、tool、MCP 资产，以及它们的说明、安装入口和验证脚本。

仓库的重点不是“只服务 Codex”，而是把不同类型资产的源码、部署入口和文档关系整理清楚。
当前恰好已经落地了一批 Codex 相关资产，所以在各分类下使用 `codex/` 命名空间来隔离它们。

## 目录总览

| 分类 | 作用 | 当前组织方式 | 索引文档 |
| --- | --- | --- | --- |
| [`skills/`](./skills/) | AI/agent 可消费的 skill 源码 | `skills/<namespace>/<skill-name>/` | [`skills/README.md`](./skills/README.md) |
| [`tools/`](./tools/) | 可直接部署或执行的工具 | `tools/<namespace>/<tool-name>/` | [`tools/README.md`](./tools/README.md) |
| [`mcp/`](./mcp/) | MCP 服务、连接器、模板与相关说明 | `mcp/<family>/<entry-name>/` | [`mcp/README.md`](./mcp/README.md) |

## 当前资产

### Skills

- [`skills/codex/codex-manager-maintainer/`](./skills/codex/codex-manager-maintainer/)
  维护 `codex_m`，处理安装、修复、升级、迁移与官方身份切换

### Tools

- [`tools/codex/codex-tmux-bundle/`](./tools/codex/codex-tmux-bundle/)
  提供多账号 tmux + Codex 工作流打包

### MCP

- 当前还没有正式纳入的 MCP 条目
- 目录结构已经预留为：
  - `mcp/servers/`
  - `mcp/connectors/`
  - `mcp/templates/`

## 命名空间约定

仓库按“分类 + 命名空间”组织，而不是把所有条目都直接堆在分类根目录：

```text
skills/<namespace>/<skill-name>/
tools/<namespace>/<tool-name>/
mcp/<family>/<entry-name>/
```

当前只有 `codex/` 命名空间已经落地。
后续如果加入其它生态或平台的资产，应继续新增对应命名空间，而不是把新条目直接放在 `skills/` 或 `tools/` 根下。

## Source 与 Deployment 的区别

仓库保存的是源码和维护入口，不是机器本地部署结果。

例如下面这些路径都属于“部署态”，不是仓库结构本身：

- `~/.codex/skills/custom/...`
- `~/.codex-manager/...`
- `~/.codex3-manager/...`
- `%APPDATA%\npm\codex_m.ps1`
- `%APPDATA%\npm\codex3.ps1`

如果为了排障修改了本机部署副本，应把变更回写到仓库源目录，再以仓库版本为准。

## 推荐查看顺序

1. 先看根目录这个 `README.md`，理解仓库定位和整体结构。
2. 再看分类索引：
   - [`skills/README.md`](./skills/README.md)
   - [`tools/README.md`](./tools/README.md)
   - [`mcp/README.md`](./mcp/README.md)
3. 如果是 Codex 相关资产，再进入对应命名空间：
   - [`skills/codex/README.md`](./skills/codex/README.md)
   - [`tools/codex/README.md`](./tools/codex/README.md)
4. 最后进入具体条目的 `README.md` 或 `SKILL.md`。
