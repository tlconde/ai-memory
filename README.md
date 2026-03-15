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

### Cursor
```
/add-plugin ai-memory
```

### Claude Code
```
/plugin install ai-memory
```

### From source
```
/add-plugin /path/to/ai-memory/plugins/ai-memory
```

### CLI only
```bash
npm install -g @radix-ai/ai-memory
# or
npx @radix-ai/ai-memory init
```

---

## Quick start

```bash
# 1. Scaffold .ai/ in your project
npx @radix-ai/ai-memory init

# 2. Fill in what your project is
# Edit .ai/IDENTITY.md and .ai/DIRECTION.md

# 3. Start your AI tool — it will read .ai/ automatically
# The MCP server starts via .mcp.json

# 4. At the end of a session with real learning:
/mem:compound
```

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
| `/mem:compound` | End of any session with real learning |
| `/mem:session-close` | End of a short/exploratory session |
| `/mem:init` | First-time project setup |
| `/mem:validate` | Before a risky change (Full tier) |

---

## CLI

```bash
ai-memory init [--full]          # Scaffold .ai/
ai-memory install --to <tool>    # Bootstrap for cursor, windsurf, cline, copilot, claude-code
ai-memory mcp                    # Start MCP server
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

`validate_context` in `/mem:compound` (Step 5) will hard-block any commit that violates a [P0] rule.

---

## Search

Default: keyword search (BM25). No setup, no downloads.

To enable semantic search, add to `.ai/config.json`:
```json
{ "search": "semantic" }
```
This downloads a ~23MB model to `~/.cache/ai-memory/models/` on first use.

For external API:
```json
{ "search": "api", "embeddingProvider": "openai" }
```

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

---

## Multi-agent & iterative loops

ai-memory is designed for concurrent agents and RALPH-style iteration loops.

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
- **Cursor Background Agents**: `.ai/` is in the git clone, MCP server starts per-agent
- **Claude Code worktrees**: `.ai/` is copied to the worktree; run `/mem:compound` before exit to persist
- **Claude Code sandbox**: works if sandbox allows subprocess spawning and `.ai/` is within boundaries

### Immutability model

| File | Default | Control |
|---|---|---|
| `IDENTITY.md` | Immutable | Set `writable: true` in frontmatter to allow AI writes |
| `DIRECTION.md` | Writable | Set `writable: false` in frontmatter to lock |
| `toolbox/`, `acp/`, `rules/` | Always immutable | Structural — no override |
| Everything else | Writable | Via `commit_memory` tool |

### Sub-agent integration

Work done by sub-agents (skills, background tasks, worktree agents) is only persisted if:
1. The sub-agent has MCP access (`.mcp.json` present) AND calls `commit_memory`
2. OR the sub-agent runs `/mem:compound` before exiting
3. OR the sub-agent commits `.ai/` changes to git (which gets merged back)

The bootstrap instruction explicitly tells sub-agents: *"If running as a sub-agent, run `/mem:compound` before exiting — your memory will be lost otherwise."*

---

## ACP (Full tier)

`.ai/acp/manifest.json` declares this agent's capabilities to ACP-aware orchestrators like [`acpx`](https://github.com/openclaw/acpx). The MCP server is the transport layer; ACP is the identity layer.

---

## Evals

```bash
ai-memory eval
```

Reports: rule coverage, session cadence, frontmatter coverage, open items, deprecated ratio, memory depth, session count, memory freshness.

Add custom metrics:
```bash
ai-memory eval add my-metric
# Edit .ai/temp/custom-evals/my-metric.ts
```

---

## Related

- [acpx](https://github.com/openclaw/acpx) — Headless CLI for Agent Communication Protocol
- [Agent Communication Protocol](https://agentclientprotocol.com)
- [compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) — Plugin this system is modeled after
- [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) — Lossless context compaction (inspiration for session archive design)
- [autoresearch-at-home](https://github.com/mutable-state-inc/autoresearch-at-home) — Multi-agent iterative research (inspiration for claim system and DIRECTION.md evolution)
- [Ralph Wiggum](https://ralph-wiggum.ai/) — Iterative agent loops via plan file on disk

---

## License

MIT
