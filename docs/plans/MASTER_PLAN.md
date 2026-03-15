# ai-memory — Master Plan

**Status:** Implementation in progress
**Date:** 2026-03-15 (updated from 2026-03-14)
**Supersedes:** `AGENTIC_INFRASTRUCTURE_PLAN.md`, `SOTA_MEMORY_EVOLUTION_PLAN.md`, `PROGRESSIVE_DISCLOSURE_WORKFLOW_PLAN.md`, `plugin_distribution_plan_ca5f9553.plan.md`

---

## 1. Purpose

Most AI coding assistants forget everything between sessions. Decisions made last week, bugs already solved, patterns that work — gone on every restart. Developers end up re-explaining their stack, re-discovering the same issues, and watching the AI repeat the same mistakes.

`ai-memory` fixes this. Drop a `.ai/` directory into any project. Any AI tool — Claude Code, Cursor, Windsurf, or anything else — reads it at session start and carries knowledge forward. The project ships the infrastructure that makes that directory useful at scale: an MCP server for structured memory access, a CLI for setup and management, a plugin for one-click install, and a governance layer that enforces project rules in code rather than relying on the AI to remember them.

The system is designed to be simple to start (one command, three files) and deep when you need it. Everything beyond the core is opt-in.

---

## 2. Naming

**Package:** `@radix-ai/ai-memory` (npm, scoped to `@radix-ai` org)
**Install:** `npm install @radix-ai/ai-memory`
**CLI binary:** `ai-memory`
**Plugin name:** `ai-memory`
**Namespace for skills:** `mem:` (e.g. `/mem:compound`, `/mem:init`)

Rationale: Scoped under `@radix-ai` org — avoids npm name conflicts and groups future packages cleanly. CLI binary stays unscoped (`ai-memory`) for ergonomics.

---

## 3. Tiers (Two, Not Three)

Two tiers. The MCP server is **always present** in both — it starts automatically via `.mcp.json` when the plugin is installed, so it is invisible to the user. The difference between tiers is which features are active and which files are scaffolded.

The server being automatic is the key point: the user does not manually start it, configure it, or think about it. Cursor and Claude Code read `.mcp.json` and handle it. Having a server is not complex from the user's perspective.

### Default (`npx ai-memory init`)

Everything needed for persistent memory, working immediately:

```
.ai/
├── IDENTITY.md             — What this project is; what the AI must never do
├── DIRECTION.md            — Where it's going: focus, open questions, what's working
├── memory/
│   ├── decisions.md        — Architectural choices [P0/P1/P2]
│   ├── patterns.md         — Reusable patterns and anti-patterns
│   ├── debugging.md        — Non-obvious bugs with root cause
│   ├── improvements.md     — Incremental improvements
│   └── memory-index.md     — Auto-generated priority index
├── agents/
│   └── _base-auditor.md    — Shared audit methodology
├── skills/                 — Project domain knowledge (e.g. firebase.md)
├── toolbox/                — General tech knowledge (e.g. shell.md)
├── rules/                  — Behavioral constraints
├── sessions/
│   ├── open-items.md
│   └── archive/
│       └── thread-archive.md
└── reference/
    └── PROJECT.md          — Architecture, data models (loaded on demand only)
```

MCP server active. Tools available: `search_memory`, `commit_memory`, `get_open_items`, `get_memory`, `expand_memory`.

No downloads. No extra config. Keyword search by default.

### Full (`npx ai-memory init --full`)

Adds governance enforcement, evals, ACP, and the option to enable semantic search:

```
.ai/
├── (all Default files)
├── acp/
│   ├── manifest.json       — Agent Card for ACP orchestrators
│   └── capabilities.md
└── temp/                   — Auto-generated, never edited manually
    ├── harness.json        — Compiled rule set from [P0] entries
    ├── rule-tests/         — Coverage tests for harness rules
    └── eval-report.json    — Eval metrics
```

Additional MCP tools unlocked: `validate_context`, `validate_schema`, `generate_harness`, `prune_memory`, `get_evals`.

Semantic search is **not** enabled automatically in `--full` — it requires explicit opt-in (see §7 on search). The reason: it involves either a one-time model download or an external API key, and that should always be a conscious choice.

**The key principle:** Default gives you a working memory system with a real MCP server from day one. Full adds rule enforcement and observability when the project is mature enough to need it.

---

## 4. What Gets Built

### 4.1 Plugin (installable, priority 1)

One command in Cursor or Claude Code: `/add-plugin ai-memory`. Ships skills, rules, agents, and MCP config as one unit. No local setup required for Core tier.

### 4.2 CLI (`npx ai-memory`)

Sets up, validates, and runs the system. Extensible: users can scaffold their own agents, skills, and rules through the CLI.

### 4.3 MCP server (local stdio)

Runs locally, started by the IDE from `.mcp.json`. Reads the project's `.ai/` directory. Exposes structured tools so the AI calls `search_memory` and `validate_context` instead of reading raw files. Required for Standard+ features; Core tier works without it.

### 4.4 Governance layer (Full tier)

[P0]-tagged decisions are compiled into a machine-checkable rule set. Before any code change is committed to memory, `validate_context` runs those rules against the git diff using structural code analysis (`@ast-grep/napi`). Violations are hard-blocked — not warned, blocked.

### 4.5 Vector search (Full tier)

Memory entries become semantically searchable without an API key. Default is keyword search (always works, zero setup). Vector search is opt-in.

### 4.6 Session archive with compaction (Standard+)

Inspired by [lossless-claw](https://github.com/Martian-Engineering/lossless-claw): instead of simple tailing (keep last 200 lines), the session archive uses hierarchical compaction. Older entries are progressively summarized into higher-level nodes. The agent always sees recent messages in full and summaries of older ones — nothing is lost, but the context stays bounded.

### 4.7 Evals (Full tier, customizable)

Built-in metrics the developer can monitor. Lightweight by default (a few counters), extensible by the user. The eval system exposes a registry users can add custom metrics to.

### 4.8 VS Code/Cursor sidebar panel (Full tier)

Four tabs: Memory, Open Items, Governance, Evals. Works in both VS Code and Cursor (Cursor supports VS Code extensions natively).

---

## 5. DIRECTION.md — The Direction Document

`IDENTITY.md` holds stable constraints (what the project is, what the AI must never do). It changes rarely and intentionally.

`DIRECTION.md` holds where the project is going. The developer updates it as focus shifts. It has four sections:

```
## Current Focus      — what's being actively worked on
## Open Questions     — things not yet decided
## What's Working     — patterns worth repeating
## What to Try Next   — directions to explore
```

This distinction matters because mixing stable rules with evolving direction makes both worse. `IDENTITY.md` becomes too rigid to evolve; `DIRECTION.md` becomes too authoritative to experiment with.

The concept comes from Karpathy's autoresearch project where the "program.md" is explicitly the document humans iterate on to improve AI behavior. The name `DIRECTION.md` is clearer for first-time users than `PROGRAM.md`.

**Immutability is controlled per-file via YAML frontmatter `writable` field:**

| File | Default | Override |
|---|---|---|
| `IDENTITY.md` | `writable: false` (immutable) | Set `writable: true` to allow AI writes |
| `DIRECTION.md` | `writable: true` (mutable) | Set `writable: false` to lock |
| `toolbox/`, `acp/`, `rules/` | Always immutable | No override (structural) |

**DIRECTION.md is writable by default.** This enables RALPH-style iterative loops (see §5a) where the AI updates its own program between iterations. The plan file on disk is the shared state. Each iteration reads it, does work, writes back learnings.

**IDENTITY.md is immutable by default.** Constraints should not drift during autonomous work. Teams that want AI-assisted constraint evolution can opt in with `writable: true`.

The old `direction_writable` config in IDENTITY.md frontmatter is replaced by the `writable` field directly on DIRECTION.md itself. This is simpler and more consistent.

---

## 5a. RALPH Loops & Multi-Agent Collaboration

### Iterative self-improvement (RALPH pattern)

DIRECTION.md is the plan file. The iteration loop:
1. Agent reads DIRECTION.md, picks a task
2. Agent does work, writes decisions/patterns to memory via `commit_memory`
3. Agent updates DIRECTION.md with learnings (what worked, what to try next)
4. Agent exits (or session ends)
5. Next iteration spawns fresh, reads evolved DIRECTION.md
6. Convergence through iteration

This follows the [Ralph Wiggum](https://ralph-wiggum.ai/) pattern and [autoresearch-at-home](https://github.com/mutable-state-inc/autoresearch-at-home): the plan file on disk IS the shared state between iterations. Fresh context on each spawn prevents context degradation.

### Multi-agent collaboration (autoresearch pattern)

When multiple agents work concurrently (cloud agents, worktrees, background tasks), four mechanisms coordinate their work:

**1. Task claiming** — `claim_task` tool. Before starting work, an agent claims its task in `open-items.md`. Claims include a session_id and auto-expire after 5 minutes. This prevents duplicate work. Similar tasks are matched semantically.

**2. Result sharing** — `publish_result` tool. Every completed task (success, failure, or partial) is recorded in `thread-archive.md` with outcome, learnings, and session_id. Failed experiments are just as valuable as successes.

**3. Global best tracking** — DIRECTION.md. Agents read DIRECTION.md for the current best approach and update it with improvements. Git merges handle concurrent updates (append-only writes minimize conflicts).

**4. Improvement sharing** — `memory/improvements.md`. Agents publish incremental improvements and ideas for other agents to pick up in subsequent iterations.

### Persistence in ephemeral environments

`sync_memory` tool: stages all `.ai/` changes, creates a git commit, and optionally pushes. Essential for:
- **Worktrees**: changes disappear on cleanup unless committed
- **Cloud agents**: container is destroyed after task completion
- **Sandbox**: filesystem may be reset

The compound skill (`/mem:compound`) includes a sync step for ephemeral environments.

### Claim-based locking

`commit_memory` uses advisory file locks in `.ai/temp/locks/`:
- Before writing: create lock file with `{ session_id, timestamp, pid }`
- If lock exists from different session and is <5 minutes old: reject write
- Stale locks (>5 minutes): auto-expire, overwrite
- After writing: release lock

This handles the common case (two agents writing to the same file) without the complexity of distributed locking.

---

## 6. Lossless Session Archive (from lossless-claw)

The lossless-claw project solves a real problem: when conversation history grows long, truncation loses information permanently. Their solution is a DAG-based compaction hierarchy.

We apply this concept to `sessions/archive/thread-archive.md`:

**Current approach:** Keep last 200 lines, truncate the rest. Problem: old decisions are permanently lost.

**lossless-claw approach applied here:**
- Recent entries (last 32 messages / last session) are stored in full
- Older entries are summarized into "leaf summaries" (~1200 tokens each, covering 8+ raw entries)
- Multiple leaf summaries are condensed into higher-level nodes (~2000 tokens, covering 4+ leaves)
- The MCP `memory://tails` resource returns: full recent + relevant summaries from the hierarchy

This is handled by the `prune_memory` tool and the `mem:session-close` skill. The agent never loses old decisions — it just accesses them at different levels of detail.

Three MCP tools map to lossless-claw's access model:
- `search_memory` → like `lcm_grep`: search across all levels of the archive
- `get_memory` → like `lcm_describe`: get a summary of a topic
- `expand_memory` → like `lcm_expand`: retrieve full detail for a specific compressed section

---

## 7. Search Options

**Default: keyword search. No downloads. No config. Always works.**

### Default — Keyword search (BM25)

Pure text matching across `.ai/` files using BM25 (the same ranking algorithm used by search engines and code search tools). Zero dependencies. Works offline. Fast enough for any realistic `.ai/` directory size.

Nothing is downloaded. Nothing is configured. It just works.

### Opt-in — Local semantic search

Enables "anything about authentication" to find relevant entries even when the word "authentication" doesn't appear. Uses `@xenova/transformers` with a small local model.

**What this means concretely:** on first use, a ~23MB model file is downloaded to `~/.cache/ai-memory/models/`. This happens once. After that it runs locally and fast. No data leaves your machine.

Enable per-project in `.ai/config.json`:
```json
{ "search": "semantic" }
```
Or via environment: `AI_SEARCH=semantic`

### Opt-in — External API

Uses an external embedding API (OpenAI, Anthropic, or others). Fastest and most accurate. Requires an API key and sends memory content to the provider.

Enable:
```json
{ "search": "api", "embeddingProvider": "openai" }
```
Or via environment: `AI_SEARCH=api` + `AI_EMBEDDING_API_KEY=...`

No provider is installed or called unless explicitly configured. The default install touches none of this.

---

## 8. ACP Integration

ACP (Agent Communication Protocol) is a protocol for structured agent-to-agent communication. It answers the question: "when two AI agents need to work together, how do they describe what they can do and how to reach each other?"

For `ai-memory`, ACP integration means three things:

### 8.1 The Agent Card (`acp/manifest.json`)

A machine-readable description of what this agent can do and how to reach it. An ACP-aware orchestrator (like `acpx`) reads this and knows: "this project has an ai-memory agent that understands memory.read, memory.write, and memory.validate — and I can reach it via MCP on stdio."

This is separate from `agents/` (which contains prose instructions for the LLM). `acp/` is metadata about the agent for other software. `agents/` is instructions for the AI.

```json
{
  "name": "ai-memory-agent",
  "description": "Persistent project memory with governance enforcement",
  "version": "1.0.0",
  "capabilities": ["memory.read", "memory.write", "memory.search", "memory.validate", "compound.run"],
  "transport": { "type": "mcp", "mode": "stdio", "command": "npx ai-memory mcp" }
}
```

### 8.2 ACP as a discovery layer on top of MCP

The MCP server is the transport (how messages are exchanged). ACP is the identity layer (what this agent is and what it offers). ACP orchestrators use the manifest to discover and connect to MCP servers automatically.

### 8.3 AGENTS.md — the stub problem solved

The root `AGENTS.md` file (read by Claude Code) caused friction because it tried to be both a behavioral instruction and a protocol identity declaration. These are different things for different consumers.

Solution: `AGENTS.md` at project root is a 3-line stub that redirects to the right place for each purpose:

```markdown
# Agent Instructions

See `.ai/IDENTITY.md` for behavioral constraints and `.ai/DIRECTION.md` for current project direction.
For ACP agent card, see `.ai/acp/manifest.json`.
```

---

## 9. CLI Extensibility

The CLI is not just for setup — it is for extending and customizing the system. Users can scaffold their own agents, skills, and rules without manually copying template files.

### Built-in commands

| Command | What it does |
|---|---|
| `ai-memory init` | Scaffold `.ai/` (Core by default; `--standard` or `--full` for more) |
| `ai-memory mcp` | Start MCP server on stdio |
| `ai-memory validate` | Validate all `.ai/` files against canonical schema |
| `ai-memory fmt` | Auto-format YAML frontmatter |
| `ai-memory eval` | Run eval report |
| `ai-memory prune` | Review and archive stale entries (`--dry-run` to preview) |
| `ai-memory generate-harness` | Regenerate `harness.json` from current [P0] entries |

### Extensibility commands

| Command | What it does |
|---|---|
| `ai-memory agent create <name>` | Scaffold a new agent in `.ai/agents/<name>/AGENT.md` with YAML frontmatter |
| `ai-memory skill create <name>` | Scaffold a new skill in `.ai/skills/<name>/SKILL.md` |
| `ai-memory rule create <name>` | Scaffold a new rule in `.ai/rules/<name>.md` |
| `ai-memory eval add <name>` | Scaffold a custom eval metric in `.ai/temp/custom-evals/<name>.ts` |
| `ai-memory install --to cursor\|claude\|codex\|opencode` | Install plugin to other AI tools |
| `ai-memory sync --to cursor\|claude\|all` | Sync canonical `.ai/` to tool-specific stubs |

All `create` commands drop a pre-filled file with the correct YAML frontmatter and section structure so users start with valid files, not blank ones.

---

## 10. Governance Layer (Full tier)

### How rule checking works

Project rules tagged `[P0]` in `decisions.md` and `debugging.md` can carry a `constraint_pattern` in their YAML frontmatter. The `generate_harness` tool reads all [P0] entries and compiles them into `.ai/temp/harness.json` — a machine-checkable rule set.

`validate_context(git_diff)` loads the harness and checks the diff using `@ast-grep/napi`, a structural code analysis library that understands syntax trees. This matters because text-based grep misses things like renamed imports or different syntax styles expressing the same pattern.

Example entry in `decisions.md`:

```yaml
---
id: decision-007
type: decision
status: active
tags: [auth, p0]
constraint_pattern:
  type: ast
  language: typescript
  pattern: "import $_ from '$LIB'"
  where:
    LIB:
      regex: "passport|jsonwebtoken|bcrypt"
  path: "src/**/*.ts"
---
### [P0] No external auth libraries

**Context:** External auth libraries have a large attack surface and are hard to audit.
**Decision:** Use the internal auth module only.
**Rationale:** Full control over token format and expiry policy.
**Tradeoffs:** More maintenance burden; worth it for security posture.
```

Compiled `harness.json` rule:
```json
{
  "id": "decision-007",
  "type": "ast",
  "language": "typescript",
  "pattern": "import $_ from '$LIB'",
  "where": { "LIB": { "regex": "passport|jsonwebtoken|bcrypt" } },
  "path": "src/**/*.ts",
  "severity": "P0",
  "message": "[P0] External auth library — use internal auth module only (decision-007)"
}
```

Rules without `constraint_pattern` are checked narratively by the AI during compound (not in code). The goal over time is for all P0 entries to have machine-checkable patterns.

### Immutable paths

These paths are read-only from the agent's perspective. Any write attempt is blocked at the MCP server:

```
IDENTITY.md, DIRECTION.md, toolbox/, acp/, rules/
```

The agent reads them freely but cannot modify them during a compound run. Changes require a human to make the commit. This makes the governance layer trustworthy: the rules cannot be erased by the system being governed.

### Auto-harness improvement

Each harness rule has a corresponding test in `.ai/temp/rule-tests/`: a snippet that should trigger the rule, and one that should not. When a violation slips through post-hoc (caught during a debugging session), the new case is added as a test. Next time `generate_harness` runs, it synthesizes a rule that covers the new case.

This is not a training loop. No model weights change. It is an incremental improvement cycle: add a test case → regenerate → the rule now covers it.

---

## 11. Evals (Lightweight and Customizable)

Evals are opt-in metrics. The default install has no eval overhead.

### Default (zero config)

When `ai-memory eval` is run, it computes six counters from existing files — no special tracking infrastructure needed:

| Metric | Source |
|---|---|
| Rule coverage | % of P0 entries with `constraint_pattern` |
| Memory freshness | Average age of active entries |
| Index coverage | % of files with valid frontmatter |
| Session cadence | Days since last compound run |
| Open items count | Count from `sessions/open-items.md` |
| Deprecated entry ratio | % marked `[DEPRECATED]` |

These come from reading files that already exist. No additional data collection.

### Full tier adds

- Gate effectiveness (how many times `validate_context` blocked something)
- Recall test pass rate (% of harness rule tests passing)
- Historical trend (stored in `temp/eval-history.jsonl`)
- Sidebar panel visualization

### Custom evals

Users can add their own metrics:

```
ai-memory eval add my-metric
```

This scaffolds `.ai/temp/custom-evals/my-metric.ts` — a simple function that reads `.ai/` files and returns a number and a label. The eval runner picks these up automatically.

---

## 12. MCP Server

### Resources

| URI | Returns | Tier |
|---|---|---|
| `memory://index` | `memory-index.md` — ranked summary of all active entries (~500 tokens) | Standard |
| `memory://tails` | Recent full entries + compacted summaries of older ones (lossless-claw pattern) | Standard |
| `memory://identity` | `IDENTITY.md` + `DIRECTION.md` | Core |
| `memory://harness/active` | Current `harness.json` | Full |
| `memory://evals` | Latest eval report | Full |
| `memory://file/{name}` | Any `.ai/` file by path, on demand | Core |

### Tools

| Tool | Input | What it does | Hard-fails if |
|---|---|---|---|
| `search_memory` | `query`, `tags?`, `semantic?: bool` | Keyword or semantic search across `.ai/` | — |
| `get_memory` | `topic` | Returns summary of a topic from the compacted archive | — |
| `expand_memory` | `node_id`, `max_tokens?` | Full detail for a compressed archive section | — |
| `validate_context` | `git_diff` | Loads `harness.json`, runs ast-grep checks, returns violations | P0 rule triggered |
| `validate_schema` | `entry` | Checks proposed memory entry against canonical schema | Required fields missing |
| `commit_memory` | `type`, `content`, `path` | Writes to `.ai/`, enforces immutability and schema | Path is immutable; schema invalid |
| `generate_harness` | — | Compiles `harness.json` from [P0] entries + writes rule tests | — |
| `get_open_items` | — | Returns `sessions/open-items.md` | — |
| `prune_memory` | `dry_run?` | Archives stale/deprecated entries | — |
| `get_evals` | — | Returns latest `eval-report.json` | — |

---

## 13. Plugin and Distribution

### Directory structure

```
ai-memory/
├── .cursor-plugin/
│   └── marketplace.json          — Cursor marketplace root manifest
├── .claude-plugin/
│   └── marketplace.json          — Claude Code marketplace root manifest
├── plugins/
│   └── ai-memory/
│       ├── .cursor-plugin/
│       │   └── plugin.json       — Per-plugin Cursor manifest
│       ├── .claude-plugin/
│       │   └── plugin.json       — Per-plugin Claude manifest
│       ├── .mcp.json             — MCP server config (added when server exists)
│       ├── agents/               — memory-auditor, governance-critic
│       ├── skills/               — mem-compound, mem-init, mem-validate, mem-session-close
│       └── README.md
```

### Install paths

```
Cursor:      /add-plugin ai-memory
Claude Code: /plugin install ai-memory
CLI:         npx ai-memory install --to codex|opencode|windsurf
```

### Skill files (universal format)

Every skill uses YAML frontmatter (compound-engineering pattern). This is what makes them portable across tools:

```yaml
---
name: mem-compound
description: Captures session learnings into memory. Use after a meaningful session, a non-obvious bug fix, or a pattern discovery.
---
```

Content uses imperative, objective language (no "you should"). Discovery framing where appropriate ("explore", "consider") rather than prescriptive commands.

### Plugin tiers

**Lite (default install):** one rule, `mem:compound`, `mem:session-close`. No MCP server required. Works in any IDE.

**Full (in plugin settings or `--full`):** all skills + agents + MCP server config. Enables governance, search, and evals.

### Marketplace submission checklist (Cursor)

- `.cursor-plugin/marketplace.json` at repo root
- `plugins/ai-memory/.cursor-plugin/plugin.json` valid
- All skills/agents/rules have YAML frontmatter with `name` and `description`
- README has install section
- Plugin tested locally before submission

---

## 14. Canonical Schema

Every file in `.ai/` has YAML frontmatter. The formatter (`ai-memory fmt`) adds and corrects it.

### Universal header

```yaml
---
id: <slug>
type: identity | direction | decision | pattern | debugging | skill | toolbox | rule | agent
version: 1.0.0
status: active | deprecated | experimental
tags: []
writable: true          # false = immutable; agent write attempts are blocked
last_updated: 2026-03-14
---
```

### Memory entry header (multi-entry files)

```yaml
---
id: memory-decisions
type: decision
layout: multi-entry     # signals: entries are sections within this file, not standalone
status: active
---
```

Individual entries within multi-entry files use inline `[P0]`/`[P1]`/`[P2]` tags and optional P0 entries can carry `constraint_pattern` as an inline YAML block.

---

## 15. Context Loading Order

Fixed order to maximize prefix caching (model sees the same static prefix across sessions — cheaper and faster):

```
1. IDENTITY.md + DIRECTION.md   — static, always first
2. memory-index.md              — ~500 tokens, ranked summary
3. Tails: recent entries full + compacted summaries of older ones
4. Full files on demand         — only when task explicitly needs them
```

Full `PROJECT.md`, full `decisions.md` etc. are never loaded wholesale at session start. The agent fetches them via MCP when the task needs them.

---

## 16. Implementation Sequence

| # | Item | Why this order |
|---|---|---|
| 1 | `package.json` + `tsconfig.json` | Foundation |
| 2 | Plugin skeleton + manifests (Cursor + Claude) | This is what users install. Make it installable first, even with stub skills |
| 3 | Core skills (mem:compound, mem:session-close) with YAML frontmatter | Most immediately useful. No server required |
| 4 | Base load rule (Lite rule) | Makes the plugin functional on install |
| 5 | `src/mcp-server/p0-parser.ts` | Parses [P0] entries → harness. Foundation for governance |
| 6 | `src/mcp-server/resources.ts` | Read-only views. Validates .ai/ directory is correctly structured |
| 7 | `src/mcp-server/tools.ts` | validate_context (ast-grep), validate_schema, commit_memory, generate_harness, search_memory |
| 8 | `src/mcp-server/index.ts` | Wire resources + tools. Server is runnable |
| 9 | `.mcp.json` in plugin | Connects plugin to server |
| 10 | `src/formatter/index.ts` | YAML validator + auto-formatter |
| 11 | `src/cli/index.ts` | init (Core/Standard/Full), mcp, validate, fmt, agent/skill/rule create |
| 12 | `src/mcp-server/embeddings.ts` | Vector search (opt-in layer, depends on tools being stable) |
| 13 | `src/evals/index.ts` | Metrics engine (depends on memory being readable) |
| 14 | Full skills + agents (mem:init, mem:validate, governance-critic, memory-auditor) | Needs server running to be fully functional |
| 15 | `src/plugin-ui/` — sidebar panel | Depends on MCP tools and evals being stable |
| 16 | `templates/` — DIRECTION.md, acp/, AGENTS.md stub | Scaffold for new projects via `init` |
| 17 | `README.md` | Documents the final system |

---

## 17. Key Design Decisions

**Why `@ast-grep/napi` from the start?**
Structural code analysis. Regex on code is fragile — the same logical rule expressed differently doesn't match. ast-grep understands syntax trees: `import $_ from 'passport'` matches any import of passport regardless of code style. TypeScript, JavaScript, Python, Go, Rust all supported. Starting right avoids migration later.

**Why keyword search as default, not embeddings?**
Zero setup, zero downloads, works offline. Most projects have < 500 memory entries. BM25 keyword search is excellent for this scale and has no dependencies. Vector search is the opt-in upgrade for larger projects.

**Why lossless-claw compaction for the archive?**
Simple tailing loses old decisions permanently. The DAG compaction pattern from lossless-claw preserves everything at the cost of summarization fidelity — a much better tradeoff. The three-level access model (recent full / summary / detail-on-demand) maps cleanly to the MCP resource pattern.

**Why DIRECTION.md separate from IDENTITY.md?**
`IDENTITY.md` is stable constraints. `DIRECTION.md` is evolving focus. Mixing them means one of them is always wrong: either constraints become stale, or direction becomes too rigid. Karpathy's autoresearch project showed that the instruction document is itself the optimization target — humans iterate on it to improve AI behavior. Separating concerns makes both better.

**Why immutable directories?**
If the agent can rewrite its own rules, the governance layer is worthless. Changes to `IDENTITY.md`, `rules/`, etc. require a human to consciously make a commit. The agent reads them freely; it cannot overwrite them during a compound run.

**Why progressive tiers (Core/Standard/Full)?**
The system is public. Someone discovering it for the first time should be able to start with three files and one skill. They should not be confronted with `temp/harness.json`, `acp/manifest.json`, and embedding configuration on day one. Complexity is opt-in and additive.

**Why CLI extensibility (agent/skill/rule create)?**
Developers extend systems. If creating a new agent means manually copying a template and filling in frontmatter, people won't do it consistently. If there's a command, they will. Scaffolding with correct structure from the start prevents broken files that fail validation later.

**Why evals as a separate tier?**
Evals are valuable for teams managing large projects with mature memory. They are overhead for someone starting out. The default six counters run from existing files with zero additional data collection. Full evals (trend history, rule test pass rates, sidebar visualization) are for projects that have grown into needing them.

---

## 18. Resolved Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Package scope | Use `ai-memory` unscoped if available on npm. Check before publish. If taken, use `@ai-memory/core`. No decision needed now — implementation uses the name as-is. |
| 2 | Session compaction split | Server is always present (Default and Full). Compaction is available in Default tier. No split needed. |
| 3 | Rule test format | JSON confirmed. `{ rule_id, should_trigger, should_not_trigger }`. |
| 4 | Custom eval metrics | Keep as TypeScript function scaffold. LLMs help users tailor. Don't add JSON descriptor variant. |
| 5 | DIRECTION.md mutability | Immutable by default. Opt-in via `direction_writable: true` in `IDENTITY.md` frontmatter. |

---

## 19. Remaining Open Question

All questions resolved. Package is `@radix-ai/ai-memory`. Implementation can begin.
