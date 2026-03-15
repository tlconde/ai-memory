---
id: memory-decisions
type: decision
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Decisions

**Format:** Tag each entry `[P0]`, `[P1]`, or `[P2]`. Include context, decision, rationale, tradeoffs.
Optional: `**Supersedes:**`, `**Superseded by:**`, `**Links to:**` for linked entries.

For `[P0]` entries, add a `constraint_pattern` block if the rule can be expressed as a code check.

---

### [P1] Tool-specific files only on explicit install

**Context:** `ai-memory init` was creating `AGENTS.md` and `CLAUDE.md` at project root for all users, even those not using Claude Code.
**Decision:** `init` only scaffolds `.ai/`. Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.agents/skills/`) are created only by `ai-memory install --to <tool>`.
**Rationale:** Users shouldn't see Claude-specific files if they use Cursor, and vice versa. Keeps project root clean.

### [P1] Portable skill directory: .agents/skills/

**Context:** Both Cursor and Claude Code discover skills from `.agents/skills/`. Previously skills were written to `.cursor/skills/` (Cursor-only).
**Decision:** All tools write skills to `.agents/skills/` — the portable standard. Context-loading rules stay tool-specific (`.cursor/rules/` for Cursor).
**Rationale:** Write once, discoverable everywhere. Skills are tool-agnostic instructions.

### [P1] DIRECTION.md writable by default, IDENTITY.md immutable

**Context:** Originally both were immutable. Karpathy's autoresearch pattern and RALPH loops require the AI to update its own program between iterations.
**Decision:** `DIRECTION.md` defaults to `writable: true`. `IDENTITY.md` defaults to `writable: false`. Both configurable via YAML frontmatter `writable` field.
**Rationale:** DIRECTION.md is the RALPH loop plan file — the AI evolves it. IDENTITY.md holds stable constraints that shouldn't drift autonomously.

### [P1] Claim-based locking for multi-agent safety

**Context:** Cloud agents, worktrees, and concurrent sessions can write to the same `.ai/` files simultaneously.
**Decision:** `commit_memory` uses advisory file locks in `.ai/temp/locks/` with 5-minute TTL. `claim_task` prevents duplicate work across agents.
**Rationale:** Simple file-based locking handles the common case without distributed infrastructure. Stale locks auto-expire.

### [P1] HTTP MCP transport for cloud agents

**Context:** Cursor cloud agents recommend HTTP over stdio (credentials stay server-side).
**Decision:** `ai-memory mcp --http --port 3100` starts an HTTP server. Auth via `AI_MEMORY_AUTH_TOKEN`, CORS via `AI_MEMORY_CORS_ORIGINS`. Stdio remains default.
**Rationale:** Opt-in HTTP keeps local usage simple. Cloud agents get secure remote access.

### [P0] No command injection in git operations

**Context:** `sync_memory` originally used `execSync` with string interpolation for git commit messages.
**Decision:** All git calls use `execFileSync` with argument arrays. No shell spawning.
**Rationale:** Prevents injection via crafted commit messages. `execFileSync` passes args directly to the process.

```yaml
constraint_pattern:
  type: regex
  pattern: "execSync\\s*\\("
  path: "src/**/*.ts"
```

### [P1] Single README as source of truth

**Context:** Had separate TOOL_ONBOARDING.md with significant overlap with README. Two files drifted out of sync.
**Decision:** Merged useful content into README.md (install table, verify section). Developer docs moved to `plugins/adapters/generic/README.md`. Deleted TOOL_ONBOARDING.md.
**Rationale:** Following compound-engineering-plugin pattern: one README, one source of truth.
