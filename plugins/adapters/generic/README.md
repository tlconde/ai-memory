---
name: universal-adapter
description: How to connect ai-memory to any AI tool. One bootstrap instruction works everywhere.
type: toolbox
status: active
---

# Universal Adapter

One bootstrap instruction connects ai-memory to any AI coding tool.

## Install (recommended)

```bash
npx @radix-ai/ai-memory install --to <tool>
```

This writes three things:
1. **Context loading** — a rules/config file that tells the AI to read `.ai/` at session start
2. **MCP server** — config for structured memory tools (search, write, validate)
3. **Skills** — slash commands in the tool's native skills directory (e.g., `/mem-compound`)

| Tool | `--to` value | Context file | Skills path | MCP config |
|---|---|---|---|---|
| Cursor | `cursor` | `.cursor/rules/00-load-ai-memory.mdc` | `.cursor/skills/` | `.cursor/mcp.json` |
| Claude Code | `claude-code` | `CLAUDE.md` | `.claude/skills/` | `.mcp.json` |
| Antigravity | `antigravity` | `.agents/rules/00-load-ai-memory.md` | `.agents/skills/` | Global (`~/.gemini/antigravity/mcp_config.json`) |
| Copilot | `copilot` | `.github/copilot-instructions.md` | (manual) | None (no MCP) |

## Manual setup

Copy the content of `BOOTSTRAP_INSTRUCTION.md` into your tool's context-loading file.

## MCP transport

| Environment | Transport | Command |
|---|---|---|
| Local IDE | stdio (default) | `npx @radix-ai/ai-memory mcp` |
| Cloud agents | HTTP | `npx @radix-ai/ai-memory mcp --http --port 3100` |

Set `AI_MEMORY_AUTH_TOKEN` for HTTP auth. Set `AI_MEMORY_CORS_ORIGINS` to restrict origins.

## Adding support for a new tool

1. Find where the tool loads persistent context (rules file, system prompt, plugin manifest)
2. Paste `BOOTSTRAP_INSTRUCTION.md` content there
3. If the tool supports MCP, add `.mcp.json` to the project root
4. Add the tool to `TOOL_ADAPTERS` in `src/cli/adapters.ts`
5. Open a PR to contribute the adapter
