> **HISTORICAL — 2026-05-31.** V1 launch board is complete (`82962bf` gate green). Active work is tracked in `docs/specs/AMP_ROADMAP.md`. Historical reference only.

# AMP v1 Launch Board

> **Branch:** `ralph/amp-v1-v1-31` (docs complete; base `ralph/amp-v1-v1-30`)
> **Mode:** Composer/Ralph implement; Codex evaluates.  
> **Start state:** Wave 2 complete; acceptance gate passes at commit `82962bf`.

## Baseline Command

Run before assigning work:

```bash
npm run typecheck
npm run build
npm test
npm run amp:acceptance
```

## Wave 1 — Contract Freeze — **Complete**

Tasks V1-01 through V1-06 are complete. Historical task prompts live in `docs/plans/AMP_V1_TASKS.md`.

## Wave 2 — Parallel Adapter Proofs — **Complete**

All Wave 2 tasks merged through V1-30. Acceptance gate passes at `82962bf`.

| Lane | Tasks | Status |
|---|---|---|
| Storage | V1-07 through V1-11 | Complete |
| Harness | V1-12 through V1-16 | Complete |
| Procedures | V1-17 through V1-21 | Complete |
| CLI | V1-22 through V1-26 | Complete |
| E2E / RC | V1-27 through V1-30 | Complete |

## Remaining Work

V1-01 through V1-31 are complete. No implementation lanes remain for v1 offline acceptance.

Post-v1 optimizer/upstream-sync work is tracked separately in `docs/plans/AMP_POST_V1_OPTIMIZER_UPSTREAM_PLAN.md`; it does not extend the v1 offline acceptance scope.

## Evaluator Gate — Wave 2 Complete

Codex should run:

```bash
npm run typecheck
npm run build
npm test -- src/amp/
npm test
npm run amp:acceptance
```

Then check:

- Acceptance gate passes with only INV-3 deferred.
- No task broadened adapter scope beyond verified systems.
- No runtime state was given `curation_mode`.
- No procedure compiler behavior was implemented before the canonical schema.
- No path-safety guard was weakened.
- Unsupported features still return explicit capability errors.
- PROVISIONAL/UNKNOWN exclusions are documented (live gbrain serve, live harness session loading).

Full acceptance output: `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.
