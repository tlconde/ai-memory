# AMP v1 Launch Board

> **Branch:** `ralph/amp-v1`  
> **Mode:** Composer/Ralph implement; Codex evaluates.  
> **Start state:** vertical slice is green. Begin with contract-freeze tasks.

## Baseline Command

Run before assigning work:

```bash
npm run typecheck
npm run build
npm test
```

## Wave 1 — Contract Freeze

Do these first. They define the stable shape every parallel lane needs.

### Worker 1 — V1-01 Config

Task block to append to `docs/plans/AMP_V1_COMPOSER_PROMPT.md`:

```text
V1-01 — AMP config schema and discovery
Owns: src/amp/config/**, src/amp/index.ts, tests.
Build: project config plus user config resolution; runtime path defaults for macOS/Linux; test override path.
Verify: npm test -- src/amp/config/ && npm run typecheck.
Commit: feat(amp): add v1 config discovery.
```

### Worker 2 — V1-02 SSA/SAS Loaders

```text
V1-02 — SSA/SAS schema loaders
Owns: src/amp/ssa/**, src/amp/sas/**, ssa-files/*.yaml, sas-files/*.yaml, tests.
Build: YAML loading, Zod validation, external claim label field, capability coverage parsing integration.
Verify: npm test -- src/amp/ssa/ src/amp/sas/ && npm run typecheck.
Commit: feat(amp): validate SSA and SAS specs.
```

### Worker 3 — V1-03 Adapter Contract

```text
V1-03 — Adapter contract hardening
Owns: src/amp/adapter-contract/**, tests.
Build: role declaration, operation result types, unsupported capability errors, transaction contract shape.
Verify: npm test -- src/amp/adapter-contract/ && npm run typecheck.
Commit: feat(amp): harden adapter contract for v1.
```

### Worker 4 — V1-04 Conformance Runner

```text
V1-04 — Conformance runner
Owns: src/amp/conformance/**, tests.
Build: executable conformance runner with invariant IDs and adapter-targeted suites.
Verify: npm test -- src/amp/conformance/ && npm run typecheck.
Commit: test(amp): add v1 conformance runner.
```

### Worker 5 — V1-05 Feedback Schema

```text
V1-05 — Correction frame and deterministic feedback schema
Owns: src/amp/core/**, src/amp/substrate/inference/**, tests.
Build: correction frame helpers and per-user deterministic override table shape; no fine-tuning.
Verify: npm test -- src/amp/core/ src/amp/substrate/inference/ && npm run typecheck.
Commit: feat(amp): add deterministic correction feedback schema.
```

### Worker 6 — V1-06 Shared Curation Guardrails

```text
V1-06 — Shared curation mode guardrails
Owns: src/amp/core/**, tests.
Build: explicit promotion/demotion helpers for shared; no automatic promotion.
Verify: npm test -- src/amp/core/ && npm run typecheck.
Commit: feat(amp): enforce shared curation guardrails.
```

## Wave 1 Parallel Safety

V1-01, V1-02, V1-03, and V1-04 can run in parallel if each worker stays inside owned files.

V1-05 and V1-06 both touch `src/amp/core/**`; do not run them in parallel with each other. Run V1-05 first, then V1-06, or assign them to one worker as two sequential Ralph loops with two commits.

If V1-03 changes exported contract types used by V1-02 or V1-04, pause and rebase those workers before continuing.

## Wave 2 — Parallel Adapter Proofs

Start only after Wave 1 is merged and green.

| Lane | Tasks | Can run with |
|---|---|---|
| Storage | V1-07 through V1-11 | Harness, Procedures schema, CLI shell |
| Harness | V1-12 through V1-16 | Storage, Procedures schema, CLI shell |
| Procedures | V1-17 through V1-20 | Storage/Harness spikes; V1-21 waits for adapters |
| CLI | V1-22 through V1-24 | Storage/Harness if it uses stubs behind contract |
| E2E fixtures | V1-27 | Everything; final assertions wait for real adapters |

## Do Not Start Yet

- V1-21 propagation service waits for real harness emissions and procedure registry.
- V1-25 capture/consolidate/retrieve CLI waits for gbrain-backed consolidation.
- V1-26 propagate command waits for propagation service.
- V1-28 through V1-31 wait for real adapter proofs.

## Evaluator Gate After Wave 1

Codex should run:

```bash
npm run typecheck
npm run build
npm test -- src/amp/
npm test
```

Then check:

- No task broadened adapter scope beyond verified systems.
- No runtime state was given `curation_mode`.
- No procedure compiler behavior was implemented before the canonical schema.
- No path-safety guard was weakened.
- Unsupported features still return explicit capability errors.

