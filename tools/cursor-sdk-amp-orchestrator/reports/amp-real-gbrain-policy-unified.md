# AMP Unified Live gbrain Policy (AMP-REAL-POLICY)

> **Branch:** `ralph/amp-real-policy-unified`  
> **Scope:** Canonical policy module + backend-factory enforcement (A+B atomic)

## Operator invariants (accurate claims)

| Invariant | Label |
|---|---|
| `npm run amp:acceptance` offline/deterministic | **VERIFIED** |
| Live gbrain **writes** require `--confirm-live-gbrain-write` or `AMP_CONFIRM_LIVE_GBRAIN_WRITE=1` | **VERIFIED** — enforced in `createKnowledgeBackend({ access: "write" })` |
| Live gbrain **reads** via `amp retrieve --knowledge gbrain` | **PROVISIONAL** — connects to `gbrain serve`; user-facing warning printed |
| Preflight read-only local process probes | **VERIFIED** — `which`, `gbrain doctor`, `gbrain serve --help`; no DB mutation |
| Preflight + write guard are atomic | **VERIFIED** — do not release preflight without backend write enforcement |
| No automatic migration/cleanup/delete | **VERIFIED** |

## Not claimed

- ~~No live gbrain calls without opt-in~~ — replaced by writes-require-confirmation + documented live reads
- Live MCP round-trip success — **PROVISIONAL** (integration test opt-in)

## Canonical module

`src/amp/gbrain/live-policy.ts` — env constants, write confirmation, test enablement, cleanup helpers.

`src/amp/cli/live-gbrain-safety.ts` — thin re-export for CLI importers.

## Enforcement point

`src/amp/cli/knowledge-backend.ts` — `createWriteKnowledgeBackend()` / `access: "write"` calls `assertLiveGbrainWriteConfirmed()` before live adapter construction.
