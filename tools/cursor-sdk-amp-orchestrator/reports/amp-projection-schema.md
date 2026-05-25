# AMP Projection Schema — AMP-PROJ-03

**Task:** AMP-PROJ-03
**Branch:** `ralph/amp-proj-03-projection-schema`
**Base:** `ralph/amp-v1-v1-31` @ `43595df513b08568022f1864f2f4412c2966d941`
**Date:** 2026-05-25

## Summary

Adds TypeScript/Zod schema and path helpers for AMP v1.5 filesystem projections. Defines the four AMP-managed markdown artifacts from `AMP_CONSOLIDATED_SPEC` §4.2.1 with metadata headers for scope, `generated_at`, `source_revision`, and token-budget fields. **Schema only** — no DB reads, no file materialization, no CLI wiring.

## Four Projection Files

| Kind | Scope | Source store | Cadence | Default path |
|------|-------|--------------|---------|--------------|
| `global_projection` | global | knowledge | on_consolidation | `~/.amp/projection/global.md` |
| `global_runtime` | global | runtime | session_start_and_runtime_change | `~/.amp/runtime/global.md` |
| `project_projection` | project | knowledge | on_consolidation | `<project>/.amp/local/projection.md` |
| `project_runtime` | project | runtime | session_start_and_runtime_change | `<project>/.amp/local/runtime.md` |

Catalog: `PROJECTION_FILE_SPECS` in `src/amp/projection/schema.ts`. Path resolution: `projectionFilePath()` in `src/amp/projection/paths.ts`.

## Metadata Header Shape

Each projection document is `{ metadata, body }`:

- `amp_projection_version` — artifact version (`1.0`)
- `kind` — one of four projection kinds
- `scope` — `global` | `project` (must match kind)
- `project_ref` — required for project scope
- `generated_at` — ISO-8601 datetime
- `source_revision` — opaque source-store revision marker for freshness checks (§4.2.1 lifecycle)
- `source_store` — `knowledge` | `runtime` (derived from kind)
- `cadence` — regeneration trigger enum
- `budget` — token-budget metadata block:
  - `token_target` — per-file default from §4.2.1 (500/300/700/500)
  - `token_count` — measured tokens in this file
  - `combined_cap` — default 2,000 across all four files (§4.2.3)
  - `combined_count` — measured tokens across the set
  - `status` — `ok` | `warning` | `exceeded`
  - `truncated` + optional `truncation_marker`

Validation enforces scope/kind alignment, per-kind token targets, truncation marker when truncated, and rejects `combined_count` above `2 × combined_cap` (hard-fail threshold from §4.2.3).

## Intentionally Not Implemented

| Area | Status |
|------|--------|
| Materialization from runtime/knowledge DB | **Deferred** (AMP-PROJ-04+) |
| Token counting / truncation algorithm | **Deferred** — schema stores counts only |
| YAML frontmatter parse/serialize | **Deferred** — structured object schema only |
| `amp init` / `amp doctor` projection checks | **Deferred** |
| Harness import wiring (Claude Code `@` imports) | **Deferred** — Cursor parity UNKNOWN per spec |
| Combined-budget aggregation across four files | **Deferred** — metadata fields present, no aggregator |
| Configurable `context-budget` CLI | **Deferred** |

## Files Added

| File | Role |
|------|------|
| `src/amp/projection/constants.ts` | Artifact version, token targets, combined cap |
| `src/amp/projection/paths.ts` | Canonical path resolution |
| `src/amp/projection/schema.ts` | Zod schemas, specs catalog, parse helpers |
| `src/amp/projection/index.ts` | Narrow public exports |
| `src/amp/projection/schema.test.ts` | Shape and budget-metadata validation |

## External Claims Labels

| Claim | Label |
|-------|-------|
| Four projection paths match AMP spec §4.2.1 | **VERIFIED** (schema + path helpers + unit tests) |
| Default token targets and 2,000 combined cap | **VERIFIED** (constants match spec text) |
| Hard fail at 2× combined cap | **VERIFIED** (schema rejects over-threshold metadata) |
| Claude Code `@` import recursion depth 5 | **UNKNOWN** — cited in spec, not exercised here |
| Cursor MDC `@filename` import semantics | **UNKNOWN** — spec requires verification spike |
| Real token counts from markdown bodies | **PROVISIONAL** — no counter implemented; tests use supplied counts |

## Verification

Run from worktree root:

```bash
npm test -- src/amp/projection/
npm run typecheck
npm run amp:acceptance
```

## Residual Risks

1. **Frontmatter wire format** — future materializer must agree on YAML field names vs this schema.
2. **Token measurement** — no shared tokenizer yet; budget fields are declarative until AMP-PROJ-04+.
3. **Combined budget aggregation** — each file carries `combined_count`; cross-file consistency is not validated here.
4. **No top-level `src/amp/index.ts` re-export** — intentional narrow surface; importers use `src/amp/projection/index.js` directly.

## Ready for Codex Evaluation

**Yes** — schema/types/tests/report only; scoped to owned paths; verification commands listed above.
