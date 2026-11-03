# Claude Code Adapter

Connects ai-memory to Claude Code via:
1. **CLAUDE.md** — auto-read by Claude Code from the project root on every session
2. **AGENTS.md** — auto-read by Claude Code for agent sessions (stub pointing to `.ai/`)
3. **SessionStart hook** — injects `.ai/` context at session start
4. **Pre/PostCompact hooks** — preserve user intent around compaction
5. **Import request hook** — prepares `.ai/temp/import/latest-request.md` for cross-agent memory import
6. **Plugin manifest** — registers skills, agents, and MCP server
7. **MCP server** — structured memory tools

## Install

```bash
npx @radix-ai/ai-memory install --to claude
```

Or manually copy these files to your project:

| This file | Copy to |
|---|---|
| `CLAUDE.md` | project root `CLAUDE.md` |
| `hooks/SessionStart.js` | `.claude/hooks/SessionStart.js` |
| `hooks/PreCompact.js` | `.claude/hooks/PreCompact.js` |
| `hooks/PostCompact.js` | `.claude/hooks/PostCompact.js` |
| `.claude-plugin/plugin.json` | `.claude-plugin/plugin.json` |
| `.mcp.json` (from plugin root) | project root `.mcp.json` |

## What each file does

**`CLAUDE.md`** — Claude Code reads this automatically from the project root. It contains the bootstrap instruction: load `.ai/IDENTITY.md`, `.ai/PROJECT_STATUS.md`, and `memory-index.md` at session start.

**`hooks/SessionStart.js`** — Runs at the start of every session. Reads `.ai/IDENTITY.md`, `.ai/PROJECT_STATUS.md`, and `memory-index.md` and outputs them as session context. This ensures the AI has memory even when the CLAUDE.md instruction is in a long context and might be missed.

**Pre/PostCompact hooks** — Save a small `.ai/temp/pre-compact-dump.json` and `.ai/temp/post-compact-reminder.md` so Claude can recover the latest user intent after compaction. PostCompact is command-only in current Claude Code docs, so the hook writes a reminder file rather than using a prompt hook.

**Import request hook** — Writes `.ai/temp/import/latest-request.md` at Stop. Claude should read that request and import only durable project learnings from configured tool-native sources into `.ai/memory/`.

**`.claude-plugin/plugin.json`** — Plugin manifest that registers the MCP server. Claude Code reads this when the plugin is installed.

## Verify

After setup, start a session and ask: *"What does `.ai/IDENTITY.md` say about this project?"*

Then ask: *"Search memory for any decisions about [any topic in your project]."*
