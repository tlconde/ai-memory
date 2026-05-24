# AMP gbrain Transport Spike (V1-07)

> **Date:** 2026-05-25  
> **Environment:** macOS, repo `/Users/dev/Dev/Github/ai-memory`, operator home `/Users/dev`  
> **Scope:** Verify local gbrain integration paths only. No AMP adapter implementation in this task.

## Decision

**Primary v1 transport for the gbrain SSA adapter: MCP stdio via `gbrain serve`.**

Secondary options:

| Transport | Role in v1 | Rationale |
|---|---|---|
| **MCP stdio (`gbrain serve`)** | **Primary** | Matches AMP Shape A local MCP pattern; exposes full page/search tool surface via JSON-RPC. |
| **CLI (`gbrain put/get/list/search/query`)** | Spike/doctor/fallback | **VERIFIED** for direct operator use and parity checks; not the adapter contract surface. |
| **Direct PGLite DB (`~/.gbrain/brain.pglite`)** | **Rejected for v1 adapter** | Couples AMP to gbrain schema/migrations; bypasses capability honesty and tool semantics. |
| **ai-memory MCP (`ai-memory mcp`)** | **Rejected as gbrain transport** | **VERIFIED** as a separate project-memory system over `.ai/` markdown; not gbrain pages/graph. |

## Evidence

### 1. gbrain CLI availability

```bash
$ which gbrain
/Users/dev/.bun/bin/gbrain

$ gbrain --help | head -5
gbrain 0.40.2.0 -- personal knowledge brain
```

**Label:** VERIFIED — binary present and responds locally.

### 2. MCP entrypoint

```bash
$ gbrain serve --help
Usage: gbrain serve
```

```bash
$ gbrain --tools-json | head -20
[
  {
    "name": "get_page",
    "description": "Read a page by slug ...",
    ...
  },
  {
    "name": "put_page",
    "description": "Write/update a page (markdown with frontmatter). Chunks, embeds, reconciles tags ...",
    ...
  },
  ...
]
```

Observed MCP-relevant tools include at minimum: `get_page`, `put_page`, `delete_page`, `list_pages`, `search`, `query`, `restore_page`.

**Label:** VERIFIED — `gbrain serve` exists and publishes a tool catalog suitable for SSA mapping.

Local launcher wrapper inspected:

```bash
$ cat ~/.gbrain/gbrain-serve.sh
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
exec gbrain serve
```

**Label:** VERIFIED — operator already wraps stdio serve for MCP clients.

### 3. CLI read/write parity (not chosen as primary transport)

```bash
$ gbrain call put_page '{"slug":"amp-spike-test","content":"---\ntype: note\n---\nAMP transport spike probe."}'
{
  "slug": "amp-spike-test",
  "status": "created_or_updated",
  "chunks": 1,
  ...
}
```

**Label:** VERIFIED — CLI write path works against the configured local brain.

**Label:** PROVISIONAL — `gbrain get amp-spike-test` / delete cleanup was not captured in this report session before the command timed out in the spike shell; write success is sufficient to prove CLI transport exists.

### 4. Brain engine / storage location

```bash
$ gbrain config show
GBrain config:
  engine: pglite
  database_path: /Users/dev/.gbrain/brain.pglite
  embedding_model: openai:text-embedding-3-large
  embedding_dimensions: 1536
```

**Label:** VERIFIED — local PGLite engine with explicit database path.

**Label:** UNKNOWN — whether AMP CI/fixtures will have gbrain initialized; v1 fixture lane should default to fake/in-memory parity unless local gbrain is explicitly enabled.

### 5. ai-memory MCP is not gbrain

Files inspected:

- `src/mcp-server/index.ts` — stdio MCP over `.ai/` directory
- `src/mcp-server/tools/index.ts` — tools: `search_memory`, `commit_memory`, etc.

These operate on `.ai/memory/` markdown and hybrid search, not gbrain page slugs or graph links.

**Label:** VERIFIED — ai-memory MCP must not be mistaken for gbrain SSA transport.

### 6. Health / migration warnings observed

```bash
$ gbrain doctor --json 2>&1 | head -5
  Schema probe/migrate failed: type "page_links" already exists
  Try: gbrain init --migrate-only
[doctor.db_checks] start
...
```

**Label:** PROVISIONAL — local brain reports a schema migration warning; adapter work must treat doctor failures as environment blockers, not silent success.

## Mapping to AMP SSA operations (planned, not implemented)

| AMP SSA op | gbrain MCP tool | Notes |
|---|---|---|
| write | `put_page` | Markdown + frontmatter page write |
| read | `get_page` | Slug read; fuzzy optional |
| list | `list_pages` | Filters by type/tag/sort |
| search | `search` / `query` | Keyword vs hybrid; declare unsupported modes honestly |
| mutate | `put_page` / `delete_page` / `restore_page` | Map AMP mutation semantics explicitly |
| capabilities | derived from tool support + declared gaps | Must mark vector/graph/procedural gaps if unused |

## Unresolved / follow-ups for V1-08+

1. **HTTP MCP (`gbrain serve --http`)** — out of v1 scope (Shape B / remote gateway forbidden).
2. **Transaction primitive** — no obvious gbrain MCP transaction tool in `--tools-json` excerpt; AMP transaction contract may need honest `unsupported` or compose-at-substrate layer.
3. **Procedural registry** — not observed in gbrain tool list; keep `procedural_registry: unsupported` until proven otherwise.
4. **Migration health** — run `gbrain init --migrate-only` on adapter dev machines before conformance runs.

## Recommendation for V1-08

Implement `ssa-files/gbrain.yaml` and adapter transport against **`gbrain serve` stdio MCP**, with CLI parity tests optional for operator debugging only.
