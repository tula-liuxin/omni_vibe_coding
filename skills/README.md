# Skills

`skills/` 保存的是 skill 的仓库源码，而不是某台机器上的 `~/.codex/skills/` 运行副本。

这里的目录用于维护：

- `SKILL.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`

以及与这些资源配套的人类索引文档。

## 组织方式

采用命名空间目录：

```text
skills/<namespace>/<skill-name>/
```

当前已落地的命名空间：

- [`skills/codex/`](./codex/)
  放当前面向 Codex 的 skill

后续如果出现新的 agent 生态、内部平台或专题领域，应新增新的命名空间目录，而不是把条目直接放在 `skills/` 根下。

## 当前命名空间

- [`skills/codex/README.md`](./codex/README.md)

## 约定

- 每个 skill 目录必须包含 `SKILL.md`
- 给 Codex 用的核心说明写进 `SKILL.md`
- 给人看的总览、索引、部署说明优先写在分类 README 或命名空间 README
- skill 目录内如需补充资源，按下面的结构拆开：
  - `agents/`
  - `scripts/`
  - `references/`
  - `assets/`
- 平台相关实现要隔离，不要把 Windows、Linux、macOS 细节混写

## 仓库路径与安装路径

仓库路径示例：

- `skills/codex/codex-manager-maintainer/`
- `skills/codex/codex-dual-provider-windows/`

安装到 Codex 本机后的常见路径示例：

- `~/.codex/skills/custom/codex-manager-maintainer/`
- `~/.codex/skills/custom/codex-dual-provider-windows/`

仓库路径是源目录，安装路径是部署副本。维护时优先修改仓库路径。
