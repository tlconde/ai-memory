# ai-memory

[![CI](https://github.com/radix-ai/ai-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/radix-ai/ai-memory/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@radix-ai/ai-memory)](https://www.npmjs.com/package/@radix-ai/ai-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Persistent AI memory for any project. Drop a `.ai/` directory into any codebase — Claude Code, Cursor, Windsurf, or any other AI tool reads it at session start and carries knowledge forward.

```
npm install @radix-ai/ai-memory
npx @radix-ai/ai-memory init
```

---

## The problem

AI coding assistants forget everything between sessions. Decisions made last week, bugs already fixed, patterns that work — gone on every restart. You re-explain the stack, re-discover the same issues, watch the AI repeat the same mistakes.

## What this does

`ai-memory` gives any AI tool persistent memory by maintaining a structured `.ai/` directory in your project. The AI reads it at session start. A local MCP server gives it structured tools to search and write memory. A governance layer enforces project rules in code, not prompts.

---

## Install

The install command sets up three things: **context loading** (the AI reads `.ai/` at session start), **MCP server** (structured memory tools), and **skills** (slash commands like `/mem-compound`).

| Tool | Install | Skills |
|---|---|---|
| **Cursor** | `/add-plugin ai-memory` | `/mem-compound`, `/mem-session-close`, `/mem-validate`, `/mem-init` |
| **Claude Code** | `/plugin install ai-memory` | Same slash commands via plugin |
| **Windsurf** | `npx @radix-ai/ai-memory install --to windsurf` | Ask AI: "run the compound protocol" |
| **VS Code + Cline** | `npx @radix-ai/ai-memory install --to cline` | Ask AI: "run the compound protocol" |
| **VS Code + Copilot** | `npx @radix-ai/ai-memory install --to copilot` | Paste SKILL.md content into chat |
| **Any other tool** | Paste bootstrap instruction into system prompt | Paste SKILL.md content |

### CLI only
```bash
npx @radix-ai/ai-memory init            # scaffold .ai/
npx @radix-ai/ai-memory install --to cursor  # install for your tool
```

---

## Quick start

`install` runs `init` automatically if `.ai/` is missing, so you can run either order.

```bash
# 1. Install for your tool (scaffolds .ai/ if needed)
npx @radix-ai/ai-memory install --to cursor    # or claude-code, windsurf, cline, copilot

# 2. Fill in what your project is
# Edit .ai/IDENTITY.md and .ai/DIRECTION.md

# 3. Restart your AI tool (or start a new chat)

# 4. At the end of a session with real learning:
/mem-compound
```

Or run `init` first to scaffold `.ai/` before installing.

### Verify

After setup, start a session and ask: *"What does `.ai/IDENTITY.md` say about this project?"*

If it answers — context loading works. Then ask: *"Search memory for any decisions."* — this confirms MCP is connected.

### Troubleshooting

| Issue | What to do |
|-------|------------|
| `'ai-memory' is not recognized` | You're in the ai-memory dev repo. Run `npm run build` then `node dist/cli/index.js init` and `node dist/cli/index.js install --to cursor`. For published users, use `npx @radix-ai/ai-memory` — the package is pre-built. |
| MCP tools not available | `install` scaffolds `.ai/` if missing. Restart Cursor (or start a new chat) after install. |
| Cursor not picking up MCP | Cursor reads `.cursor/mcp.json`. The install writes it for Cursor. If you added manually, ensure the config is in `.cursor/mcp.json` (not `.mcp.json` at project root). |

---

## What gets created

```
.ai/
├── IDENTITY.md             — What this project is; constraints for the AI
├── DIRECTION.md            — Current focus, open questions, what's working
├── memory/
│   ├── decisions.md        — Architectural decisions [P0/P1/P2 tagged]
│   ├── patterns.md         — Reusable patterns and anti-patterns
│   ├── debugging.md        — Non-obvious bugs with root cause and fix
│   ├── improvements.md     — Incremental improvements over time
│   └── memory-index.md     — Auto-generated priority index
├── agents/                 — Agent methodology files
├── skills/                 — Project domain knowledge
├── toolbox/                — General tech knowledge
├── rules/                  — Behavioral constraints
├── sessions/
│   ├── open-items.md       — Live registry of open tasks
│   └── archive/
│       └── thread-archive.md
└── reference/
    └── PROJECT.md          — Architecture (loaded on demand only)
```

Add governance, evals, and ACP with `--full`:
```bash
npx @radix-ai/ai-memory init --full
```

---

## Skills

| Skill | When to use |
|---|---|
| `/mem-compound` | End of any session with real learning |
| `/mem-session-close` | End of a short/exploratory session |
| `/mem-init` | First-time project setup |
| `/mem-validate` | Before a risky change (Full tier) |
| `/mem-auto-review` | Automated PR review (Bugbot, CI, automations) |

---

## CLI

```bash
ai-memory init [--full]          # Scaffold .ai/
ai-memory install --to <tool>    # Bootstrap for cursor, windsurf, cline, copilot, claude-code
ai-memory mcp                    # Start MCP server (stdio)
ai-memory mcp --http --port 3100 # Start MCP server (HTTP, for cloud agents)
ai-memory validate               # Validate all .ai/ files
ai-memory fmt                    # Auto-format YAML frontmatter
ai-memory eval [--json]          # Memory health report
ai-memory prune [--dry-run]      # Review stale entries
ai-memory generate-harness       # Compile rule set from [P0] entries

# Extensibility
ai-memory agent create <name>    # Scaffold a new agent
ai-memory skill create <name>    # Scaffold a new skill
ai-memory rule create <name>     # Scaffold a new rule
ai-memory eval add <name>        # Add a custom eval metric
```

---

## Governance (Full tier)

Tag decisions `[P0]` and add a `constraint_pattern` to enforce them in code:

```markdown
### [P0] No external auth libraries

**Context:** ...
**Decision:** Use the internal auth module only.

\`\`\`yaml
constraint_pattern:
  type: ast
  language: typescript
  pattern: "import $_ from '$LIB'"
  where:
    LIB:
      regex: "passport|jsonwebtoken|bcrypt"
  path: "src/**/*.ts"
\`\`\`
```

Then:
```bash
ai-memory generate-harness    # Compile .ai/temp/harness.json
```

`validate_context` in `/mem-compound` will hard-block any commit that violates a [P0] rule.

---

## Multi-agent & iterative loops

### RALPH loops (iterative self-improvement)

DIRECTION.md is writable by default (`writable: true` in frontmatter). This means:
1. Agent reads DIRECTION.md, picks a task, does work
2. Agent updates DIRECTION.md with what it learned
3. Agent exits (or session ends)
4. Next iteration reads the updated DIRECTION.md
5. Natural convergence through iteration

This follows the [autoresearch](https://github.com/mutable-state-inc/autoresearch-at-home) pattern and the [Ralph Wiggum](https://ralph-wiggum.ai/) approach: **the plan file on disk is the shared state.**

### Concurrent agents (cloud agents, worktrees, background tasks)

`commit_memory` uses claim-based locking:
- Before writing, the agent acquires a claim on the target path
- If another agent holds an active claim (5-minute TTL), the write is rejected
- Claims auto-expire, so crashed agents don't permanently lock files
- Each write includes a `session_id` header for traceability

This works in:
- **Cursor Cloud Agents**: `.ai/` is in the git clone, MCP server starts per-agent
- **Claude Code worktrees**: `.ai/` is copied to the worktree; run `/mem-compound` before exit to persist
- **Claude Code sandbox**: MCP runs outside sandbox boundary — all memory tools work

### Immutability model

| File | Default | Control |
|---|---|---|
| `IDENTITY.md` | Immutable | Set `writable: true` in frontmatter to allow AI writes |
| `DIRECTION.md` | Writable | Set `writable: false` in frontmatter to lock |
| `toolbox/`, `acp/`, `rules/` | Always immutable | Structural — no override |
| Everything else | Writable | Via `commit_memory` tool |

---

## MCP server

The MCP server starts automatically via `.mcp.json`. Tools exposed:

| Tool | What it does |
|---|---|
| `search_memory` | Keyword search across `.ai/` |
| `get_memory` | Summary of a specific topic |
| `commit_memory` | Write to `.ai/` with immutability + claim-based locking |
| `get_open_items` | Return open-items.md |
| `prune_memory` | Identify stale entries |
| `validate_context` | Check git diff against [P0] rules (hard block on violations) |
| `validate_schema` | Validate memory entry frontmatter |
| `generate_harness` | Compile `harness.json` from [P0] entries |
| `get_evals` | Return latest eval report |
| `claim_task` | Claim a task to prevent duplicate work across agents |
| `publish_result` | Publish task result (success/failure) to archive |
| `sync_memory` | Git commit `.ai/` changes (essential for ephemeral environments) |

### HTTP transport (for cloud agents)

```bash
AI_MEMORY_AUTH_TOKEN=secret ai-memory mcp --http --port 3100
```

| Env var | Purpose |
|---|---|
| `AI_MEMORY_AUTH_TOKEN` | Bearer token for HTTP auth (optional, no auth when unset) |
| `AI_MEMORY_CORS_ORIGINS` | Allowed origins, comma-separated (default: `*`) |

### Context7 MCP (bundled)

`.mcp.json` includes the [Context7](https://context7.com) MCP server for up-to-date docs (Cursor, Claude Code, Windsurf, etc.). Works without an API key; set `CONTEXT7_API_KEY` for higher rate limits.

---

## Evals

```bash
ai-memory eval
```

Reports: rule coverage, session cadence, frontmatter coverage, open items, deprecated ratio, memory depth, session count, memory freshness, hook coverage, skill discoverability, cloud readiness, automation readiness, integration coverage.

Add custom metrics:
```bash
ai-memory eval add my-metric
# Edit .ai/temp/custom-evals/my-metric.ts
```

---

## ACP (Full tier)

`.ai/acp/manifest.json` declares this agent's capabilities to ACP-aware orchestrators like [`acpx`](https://github.com/openclaw/acpx). The MCP server is the transport layer; ACP is the identity layer.

---

## Related

- [acpx](https://github.com/openclaw/acpx) — Headless CLI for Agent Communication Protocol
- [Agent Communication Protocol](https://agentclientprotocol.com)
- [compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) — Plugin this system is modeled after
- [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) — Lossless context compaction (inspiration for session archive design)
- [autoresearch-at-home](https://github.com/mutable-state-inc/autoresearch-at-home) — Multi-agent iterative research
- [Ralph Wiggum](https://ralph-wiggum.ai/) — Iterative agent loops via plan file on disk

---

## License

MIT
