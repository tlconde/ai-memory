# AMP Real gbrain Safety Checklist

> **Date:** 2026-05-25  
> **Scope:** Pre-real-data hardening wave (AMP-REAL-01..04)  
> **Base branch:** `ralph/amp-v1-v1-31` @ `082aada`

## Purpose

Checklist for operators testing AMP against a real local gbrain database without accidental mutation, silent migration, or acceptance-gate contamination.

## Safety invariants (non-negotiable)

| Invariant | Status |
|---|---|
| `npm run amp:acceptance` stays offline/deterministic | **VERIFIED** — no live env required |
| Live gbrain **writes** require explicit confirmation | **VERIFIED** — enforced in `createKnowledgeBackend({ access: "write" })` |
| Live gbrain **reads** via retrieve | **PROVISIONAL** — connects to `gbrain serve`; user-facing warning printed |
| Preflight read-only local process probes | **VERIFIED** — `which`, `gbrain doctor`, `gbrain serve --help`; no DB mutation |
| No harness writes outside `from-amp/` | **VERIFIED** — existing path guards |
| No automatic migration/cleanup/delete | **VERIFIED** — preflight recommends only; never runs migrate |
| Fail closed when write safety cannot be proven | **VERIFIED** — backend factory throws without confirmation |
| Preflight + write guard shipped together | **VERIFIED** — do not release preflight without backend write enforcement |

## Operator sequence

1. **Offline gate:** `npm run amp:acceptance`
2. **Preflight:** `ai-memory amp gbrain-preflight --knowledge gbrain`
3. **Backup:** copy gbrain data dir after `gbrain config show` (**PROVISIONAL** — see guide)
4. **Migrate manually** if doctor warns: `gbrain init --migrate-only` (**PROVISIONAL**)
5. **Live test (optional):** `AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-live.test.ts`
6. **Live CLI (optional):** consolidate with `--confirm-live-gbrain-write`

## Claim labels

| Topic | Label | Notes |
|---|---|---|
| Acceptance gate offline | **VERIFIED** | CI/local default |
| Preflight read-only probes | **VERIFIED** | spawn `which`, `gbrain doctor`, no mutate |
| Live write guard | **VERIFIED** | `createWriteKnowledgeBackend()` / `AMP_CONFIRM_LIVE_GBRAIN_WRITE=1` |
| gbrain backup via filesystem copy | **PROVISIONAL** | stop processes first |
| gbrain first-party backup command | **UNKNOWN** | not verified in this wave |
| Live retrieve side effects | **PROVISIONAL** | MCP stdio startup |
| delete_page cleanup | **PROVISIONAL** | soft-delete ~72h |
| Legacy slug migration | **VERIFIED absent** | no migration shipped |

## Residual risks

- Residual pages under `amp/frames/h.*` if live test cleanup fails
- Operator runs consolidate with confirmation against production brain without backup
- `gbrain doctor` migration warnings may appear even when MCP writes succeed (**PROVISIONAL** from spike)

## Related docs

- Operator guide: `docs/guides/AMP_LOCAL_TESTING.md`
- Policy module report: `tools/cursor-sdk-amp-orchestrator/reports/amp-real-gbrain-policy-unified.md`
- Spike transport: `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-spike.md`
