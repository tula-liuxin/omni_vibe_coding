# Tools

`tools/` 存放可直接部署、执行或复用的工具源码。

与 `skills/` 不同，tool 主要面向人或脚本入口，不要求 `SKILL.md`，而是要求条目目录自带清晰的 `README.md`。

## 组织方式

采用命名空间目录：

```text
tools/<namespace>/<tool-name>/
```

当前已落地的命名空间：

- [`tools/codex/`](./codex/)
  放当前与 Codex 工作流直接相关的工具

## 当前命名空间

- [`tools/codex/README.md`](./codex/README.md)

## 约定

- 每个 tool 独立一个目录
- 每个 tool 目录必须有自己的 `README.md`
- `README.md` 至少写清楚：
  - 它是什么
  - 依赖什么
  - 如何安装或部署
  - 如何使用
  - 有哪些平台限制
- 如果一个 tool 同时支持多个平台，平台细节应拆开，不要混在一段安装说明里
