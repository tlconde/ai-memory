# Tool Onboarding Guide

How to connect any AI tool to `ai-memory`. Every tool needs three things:

1. **Context loading** — the AI reads `.ai/` at session start
2. **MCP server** — structured memory access (search, write, validate)
3. **Skills/commands** — `/mem:compound`, `/mem:session-close`, etc.

Each tool has its own way of doing these. This guide covers the common ones and gives you a pattern to follow for any new tool.

---

## Quick reference

| Tool | `--to` value | Context loading | MCP | Skills/commands |
|---|---|---|---|---|
| **Claude Code** | `claude-code` | `CLAUDE.md` + SessionStart hook | ✓ | Native `/mem:compound` slash commands |
| **Cursor** | `cursor` | `.cursor/rules/00-load-ai-memory.mdc` | ✓ | On-demand rules: say "run compound" |
| **Windsurf** | `windsurf` | `.windsurfrules` | ✓ | "Follow compound protocol from .ai/skills/" |
| **VS Code + Cline** | `cline` | `.clinerules` | ✓ | "Follow compound protocol from .ai/skills/" |
| **VS Code + Copilot** | `copilot` | `.github/copilot-instructions.md` | ✗ | Paste SKILL.md content into chat |
| **Any other tool** | — | Paste bootstrap instruction | if MCP-compatible | Paste SKILL.md or ask AI to read it |

---

## The three components

### 1. Context loading

The AI needs to read `.ai/IDENTITY.md`, `.ai/DIRECTION.md`, and `.ai/memory/memory-index.md` at session start. How this happens depends on the tool:

- **File-based rules** (Cursor `.cursorrules`, Windsurf `.windsurfrules`, Cline `.clinerules`): a rules file that instructs the AI to load `.ai/`
- **Plugin hooks** (Claude Code `SessionStart`): a hook that runs at session start and injects the context
- **CLAUDE.md** (Claude Code): automatically read by Claude Code from the project root
- **System prompt** (any tool with configurable system prompt): paste the bootstrap instruction

The content is always the same — only the delivery mechanism differs. See `plugins/adapters/generic/BOOTSTRAP_INSTRUCTION.md` for the canonical text to use.

### 2. MCP server

Most modern AI tools support MCP via a `.mcp.json` file. Copy this to your project root:

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["@radix-ai/ai-memory", "mcp"],
      "env": {
        "AI_DIR": "${workspaceFolder}/.ai"
      }
    }
  }
}
```

If the tool doesn't support MCP, the AI can still read `.ai/` files directly — it just loses the structured tools (`search_memory`, `validate_context`, etc.).

### 3. Skills/commands

Skills are the protocols the AI follows (`/mem:compound`, `/mem:session-close`, etc.). How they're triggered depends on the tool:

| Tool | How skills work |
|---|---|
| **Claude Code** | Native plugin skills. `/mem:compound` works as a slash command. |
| **Cursor** | Native skills. `ai-memory install --to cursor` writes `.cursor/skills/mem-compound/SKILL.md`, `mem-session-close/`, `mem-validate/`, `mem-init/`. Type `/mem-compound` in chat. |
| **Windsurf / Cline** | Tell the AI: "Follow the compound protocol from `.ai/skills/mem-compound/SKILL.md`". The AI reads it via MCP (`memory://file/skills/mem-compound/SKILL.md`) or directly. |
| **Any tool without MCP** | Paste the content of `SKILL.md` into the chat when you want to run it. |

The key insight: skills are AI instructions in a standard format. Both Cursor and Claude Code discover them automatically. Other tools can read them via MCP or direct file access.

---

## Claude Code

**Install:** `/plugin install ai-memory` (once the plugin is published)

**Manual setup:**
```bash
npx @radix-ai/ai-memory install --to claude-code
```

This copies:
- `CLAUDE.md` to the project root (auto-read by Claude Code)
- `.claude-plugin/` manifest
- `.mcp.json`

**What Claude Code reads automatically:**
- `CLAUDE.md` at project root — always loaded
- `AGENTS.md` at project root — loaded for agent sessions

Both files are stubs that point to `.ai/`. See `plugins/adapters/claude-code/` for the hook implementation.

---

## Cursor

**Install:** `/add-plugin ai-memory` (once published to marketplace)

**Manual setup:**
```bash
npx @radix-ai/ai-memory install --to cursor
```

This copies:
- `.cursor/rules/00-load-ai-memory.mdc` — stub that tells Cursor to load `.ai/`
- `.cursor-plugin/` manifest
- `.mcp.json`

---

## Windsurf

**Manual setup:**
```bash
npx @radix-ai/ai-memory install --to windsurf
```

This creates:
- `.windsurfrules` at project root with the bootstrap instruction
- `.mcp.json`

---

## VS Code + Cline

**Manual setup:**
```bash
npx @radix-ai/ai-memory install --to cline
```

This creates:
- `.clinerules` at project root
- `.mcp.json`

---

## VS Code + GitHub Copilot

Copilot doesn't support MCP. Context loading only.

```bash
npx @radix-ai/ai-memory install --to copilot
```

This creates:
- `.github/copilot-instructions.md` with the bootstrap instruction

Skills are run manually by pasting the skill content into chat.

---

## Adding a new tool

Any tool that lets you configure what the AI reads at session start can work with ai-memory. The steps:

1. Find out how your tool loads initial context (rules file, system prompt, plugin, etc.)
2. Copy the canonical bootstrap instruction from `plugins/adapters/generic/BOOTSTRAP_INSTRUCTION.md`
3. Paste it into whatever format your tool expects
4. If your tool supports MCP, add `.mcp.json` to the project root
5. If your tool has custom command/skill support, paste `SKILL.md` content as custom prompts

To add official support for a new tool, add it to the `TOOL_ADAPTERS` map in `src/cli/index.ts` and update the quick reference table above.

Open an issue or PR at the repository to contribute the adapter.

---

## Verifying setup

After setup, start a session and ask: *"What does `.ai/IDENTITY.md` say about this project?"*

If the AI can answer — context loading works.

If MCP is configured, ask: *"Search memory for any decisions about authentication."* The AI should call `search_memory`.
