# MCP API Specification

**Protocol:** Model Context Protocol (MCP) over stdio
**Server:** `npx @radix-ai/ai-memory mcp`
**Configuration:** `.mcp.json` at project root

---

## Resources (context layer)

| URI | Description | MIME |
|---|---|---|
| `memory://identity` | IDENTITY.md + DIRECTION.md combined | text/markdown |
| `memory://index` | memory-index.md (~500 tokens) | text/markdown |
| `memory://tails` | Recent entries from decisions, debugging, patterns, thread-archive | text/markdown |
| `memory://harness/active` | Active harness.json rules (Full tier) | application/json |
| `memory://evals` | Latest eval-report.json | application/json |
| `memory://file/{path}` | Any file within `.ai/` by relative path | text/markdown |

---

## Tools (action layer)

### Core memory

| Tool | Description | Required params |
|---|---|---|
| `search_memory` | BM25 keyword search across `.ai/` files | `query: string`, optional `tags: string[]` |
| `get_memory` | Summary of a specific topic (proxies to search, top 5) | `topic: string` |
| `commit_memory` | Write to `.ai/` with immutability + claim-based locking | `path: string`, `content: string`, optional `append: bool`, `session_id: string` |
| `get_open_items` | Returns sessions/open-items.md | — |
| `prune_memory` | Identify deprecated entries for archiving | optional `dry_run: bool` (default: true) |

### Governance (Full tier)

| Tool | Description | Required params |
|---|---|---|
| `validate_context` | Check git diff against [P0] harness rules. P0 violations throw `McpError(InvalidRequest)` (hard block). P1/P2 return `isError: true` (soft warning). | `git_diff: string` |
| `validate_schema` | Validate memory entry frontmatter against canonical schema | `entry: object` |
| `generate_harness` | Compile harness.json from [P0] entries with `constraint_pattern` | — |
| `get_evals` | Returns latest eval report | — |

### Multi-agent collaboration

| Tool | Description | Required params |
|---|---|---|
| `claim_task` | Claim a task from any task source file. Prevents duplicate work. Claims expire after 5min. | `task_description: string`, optional `source: string` (default: `sessions/open-items.md`), `session_id: string` |
| `publish_result` | Publish task result (success/failure/partial) to thread-archive. Records learnings. | `summary: string`, `outcome: "success"\|"failure"\|"partial"`, optional `learnings: string`, `session_id: string` |
| `sync_memory` | Git commit all `.ai/` changes. Essential for ephemeral environments. | optional `message: string`, `push: bool` |

---

## Immutability model

| Path | Default | Override |
|---|---|---|
| `IDENTITY.md` | Immutable | Set `writable: true` in frontmatter |
| `DIRECTION.md` | Writable | Set `writable: false` in frontmatter |
| `toolbox/`, `acp/`, `rules/` | Always immutable | No override |
| Everything else | Writable | — |

Immutability is checked per-write by `commit_memory`. The check reads the file's YAML frontmatter `writable` field.

---

## Claim-based locking

`commit_memory` and `claim_task` use advisory file locks in `.ai/temp/locks/`.

- Lock file: `.ai/temp/locks/<path-hash>.lock`
- Contents: `{ session_id, timestamp, pid }`
- TTL: 5 minutes (stale claims auto-expire)
- If another session holds an active claim, the write is rejected with a clear error

---

## Session tracking

Every `commit_memory` write includes a session attribution header:
```
<!-- session:s-abc123 at:2026-03-15T14:30:00.000Z -->
```

This enables tracing which agent wrote what, across concurrent and iterative sessions.

---

## Error handling

| Condition | Behavior |
|---|---|
| P0 violation in `validate_context` | `McpError(InvalidRequest)` — hard block |
| P1/P2 violation | Returns result with `isError: true` — soft warning |
| Write to immutable path | `McpError(InvalidRequest)` with explanation |
| Path traversal attempt | `McpError(InvalidRequest)` |
| Active claim by another session | `McpError(InvalidRequest)` with claim details |
| Missing `.ai/` directory | Server exits with stderr message |
| Malformed harness.json | `McpError(InternalError)` — regenerate |
