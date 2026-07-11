# Commands

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run validate:product
bun run validate:skill
bun run build:web
git diff --check
```

Application smoke:

```sh
agents packages run skyagent -- version --json
agents packages run skyagent -- doctor --json
agents packages run skyagent -- tui --smoke
```

MCP protocol entry:

```sh
agents packages run skyagent -- mcp
```
