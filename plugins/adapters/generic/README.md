---
name: universal-adapter
description: How to connect ai-memory to any AI tool. One bootstrap instruction works everywhere.
type: toolbox
status: active
---

# Universal Adapter

One bootstrap instruction connects ai-memory to any AI coding tool. No separate adapter per tool.

## Install (recommended)

```bash
npx @radix-ai/ai-memory install --to <tool>
```

Supported `--to` values:

| Tool | File written |
|---|---|
| `cursor` | `.cursor/rules/00-load-ai-memory.mdc` |
| `windsurf` | `.windsurfrules` |
| `cline` | `.clinerules` |
| `copilot` | `.github/copilot-instructions.md` |
| `claude-code` | `CLAUDE.md` (+ SessionStart hook) |

## Manual setup

Copy the content of `BOOTSTRAP_INSTRUCTION.md` into your tool's context-loading file.

| Tool | Where to put it |
|---|---|
| **Cursor** | `.cursor/rules/00-load-ai-memory.mdc` |
| **Windsurf** | `.windsurfrules` |
| **VS Code + Cline** | `.clinerules` |
| **VS Code + Copilot** | `.github/copilot-instructions.md` |
| **Claude Code** | `CLAUDE.md` at project root |
| **Any other tool** | System prompt, rules file, or equivalent context-loading mechanism |

## MCP server (optional but recommended)

If your tool supports MCP, also copy `.mcp.json` from `plugins/ai-memory/.mcp.json` to your project root.
This gives the AI direct access to `search_memory`, `commit_memory`, and all other memory tools.

Tools with confirmed MCP support: Claude Code, Cursor, Windsurf, Cline.

## How it works

The bootstrap instruction tells the AI to:
1. Load `IDENTITY.md`, `DIRECTION.md`, and `memory-index.md` at session start
2. Search `.ai/memory/` before starting tasks
3. Use MCP tools when available (falls back to file reads if not)
4. Write new entries via `commit_memory`, not direct file edits

The same instruction works in any tool because it's tool-agnostic: it describes *what to read*, not *how* to read it.

## Adding a new tool

No adapter directory needed. Just:
1. Find where the tool loads persistent context (rules file, system prompt config, plugin manifest)
2. Paste `BOOTSTRAP_INSTRUCTION.md` content there
3. If the tool supports MCP, add `.mcp.json`
4. Open a PR to add the tool to the install matrix in `src/cli/index.ts`
