# AMP gbrain Live Verification (V1-LIVE-01)

> **Date:** 2026-05-25  
> **Environment:** macOS, worktree `/Users/dev/Dev/Github/ai-memory/.cursor/worktrees/amp-live-01`, branch `ralph/amp-v1-live-01`  
> **Scope:** Opt-in live MCP round trip via `GbrainKnowledgeAdapter` + `gbrain serve` stdio. Fake transport unit tests unchanged.

## Summary

Added `src/amp/integration/gbrain-live.test.ts`, skipped unless `AMP_LIVE_GBRAIN=1`. Live run against local gbrain 0.40.2.0 succeeded after adapter fixes for three live payload mismatches (slug encoding, get_page shape, list_pages shape).

## Commands

### Default CI / local (live skipped)

```bash
cd /Users/dev/Dev/Github/ai-memory/.cursor/worktrees/amp-live-01
node --import tsx --test src/amp/adapters/ssa/gbrain/adapter.test.ts src/amp/integration/gbrain-live.test.ts src/amp/integration/gbrain-harness-e2e.test.ts
npm run typecheck
```

**Outcome:** PASS — live suite reported skipped (`# set AMP_LIVE_GBRAIN=1 to run against gbrain serve`).

### Live opt-in (gbrain on PATH)

```bash
cd /Users/dev/Dev/Github/ai-memory/.cursor/worktrees/amp-live-01
AMP_LIVE_GBRAIN=1 node --import tsx --test src/amp/integration/gbrain-live.test.ts
```

**Outcome:** PASS — write → read → list → keyword search → `delete_page` soft-delete cleanup.

Preflight:

```bash
which gbrain          # /Users/dev/.bun/bin/gbrain
gbrain --version      # gbrain 0.40.2.0
gbrain doctor --json  # status warnings; see Migration warnings below
```

## Live claims (labeled)

| Operation | Label | Evidence |
|---|---|---|
| **write** (`put_page` via adapter) | **VERIFIED** | Live test passes after slug encoding fix (`amp/frames/h.{hex}`); bare base64url segments failed with `Page not found` |
| **read** (`get_page` via adapter) | **VERIFIED** | Live test passes after parsing `frontmatter.amp_frame` from structured get_page payloads |
| **list** (`list_pages` + filter) | **VERIFIED** | Live test passes after handling bare-array list_pages payloads |
| **search** (keyword via `search` tool) | **VERIFIED** | Live test finds probe token in keyword search hits |
| **delete** (`delete_page` cleanup) | **PROVISIONAL** | MCP returns `status: soft_deleted` (72h recoverable via `restore_page`); post-delete `get_page` errors rather than empty read |

## Migration / lock warnings

```text
Schema probe/migrate failed: MultiXactId 2 has not been created yet -- apparent wraparound
Try: gbrain init --migrate-only
```

**Label:** PROVISIONAL — warning prints on every `gbrain serve` / CLI invocation in this environment. `put_page` / MCP round trip still succeeded; operator should run `gbrain init --migrate-only` before relying on doctor as a gate.

**Label:** PROVISIONAL — `gbrain doctor --json` reports `connection` warn (`Could not connect to configured DB`); MCP stdio path still functional for local verification.

## Adapter fixes discovered during live run

1. **Slug encoding:** gbrain rejects `put_page` when the final path segment is valid base64 (interprets as decoded slug lookup). Switched `frameIdToSlug` to `amp/frames/h.{hex}`.
2. **Read payload:** live `get_page` returns structured JSON with `frontmatter.amp_frame`, not markdown `content` string. Added `extractAmpFrameFromPageResult`.
3. **List payload:** live `list_pages` returns a bare array, not `{ pages: [...] }`. Extended `extractListedSlugs`.

## Residual risks

- **Soft-delete cleanup only:** test cleanup uses `delete_page`; pages remain recoverable for ~72h. Residual slugs under `amp/frames/h.*` possible if cleanup fails or operator skips live test finally block.
- **Migration warning noise:** environments with schema drift may block operator trust in doctor without blocking MCP writes (observed here).
- **Hybrid/vector search:** live test exercises keyword `search` only; hybrid `query` remains PROVISIONAL (fake transport covered in unit tests).
- **Slug scheme version bump (V1-LIVE-01-FIX-A):** new writes use locked `amp/frames/h.{hex}` encoding (UTF-8 frame id → lowercase hex, `h.` prefix). Legacy base64url final segments are abandoned because live gbrain resolves them as decoded slug lookups. **No migration** in this wave — old base64url pages remain at their original slugs; regression tests in `frame-codec.test.ts` lock the new contract.

## Test artifact slug pattern

Live test uses unique frame ids: `live-v1-{timestamp}-{random}` → slug `amp/frames/h.{hex}`. Safe to grep/list under prefix `amp/frames/h.` if cleanup fails.
