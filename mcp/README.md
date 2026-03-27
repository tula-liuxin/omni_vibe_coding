# MCP

`mcp/` 存放 MCP 相关资产的仓库源码，包括 server、connector、模板和接入说明。

当前还没有正式纳入的 MCP 条目，但目录结构先按 family 拆开，避免未来把 server、connector 和模板混放在一起。

## 组织方式

```text
mcp/servers/<entry-name>/
mcp/connectors/<entry-name>/
mcp/templates/<entry-name>/
```

含义：

- `servers/`
  自建或打包后的 MCP server
- `connectors/`
  面向第三方系统的 connector / adapter
- `templates/`
  可复用的 MCP 配置模板、样例或初始化骨架

## 约定

- 每个 MCP 条目独立一个目录
- 每个条目至少提供一份 `README.md`
- README 至少说明：
  - 用途
  - 依赖
  - 部署方式
  - 启动方式
  - 如何在 Codex 或其他客户端中接入
- 如果同时支持多个平台，平台差异请拆开写

## 当前状态

- 结构已预留
- 还没有正式纳入的 MCP 条目
