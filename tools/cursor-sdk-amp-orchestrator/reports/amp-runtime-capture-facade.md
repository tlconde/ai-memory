# AMP Runtime Semantic Capture Facade

> **Task:** RUNTIME-26 — internal capture facade for future capture/consolidation
> **Base:** `ralph/amp-runtime-semantics-plan`
> **Date:** 2026-05-26
> **Scope:** facade module + CLI wiring + tests — no new capture behavior

---

## Purpose

Provide **one internal entry point** for typed runtime semantic writes so future capture and consolidation code does not bypass validation or re-implement CLI-specific persistence paths.

The facade lives in `src/amp/runtime-semantics/capture-facade.ts` and is bound to a `RuntimeStore` instance.

---

## API

```ts
createRuntimeSemanticCaptureFacade(runtime, deps?) → {
  captureExplicitCorrection(input): CaptureRuntimeCorrectionResult
  writeValidatedEntity(record): RuntimeSemanticCaptureWriteResult
}
```

| Method | Delegates to | Use when |
|--------|--------------|----------|
| `captureExplicitCorrection` | `captureRuntimeCorrection` → `writeRuntimeSemanticEntity` | Operator explicit corrections (RUNTIME-23) |
| `writeValidatedEntity` | `writeRuntimeSemanticEntity` | Generic typed entity persistence (seed, future consolidation writers) |

Both methods:

- Fail closed through existing validation (`validateRuntimeSemanticEntityForStorage`, correction mapper guards)
- Enforce facade-level provenance gates for schemas with schema-native lineage fields (`validateRuntimeSemanticEntityWriteProvenance`)
- Write **only** to `runtime_semantic_entity` via `writeRuntimeSemanticEntity`
- Never touch runtime queue rows, projection documents, or gbrain

Optional `deps.writeEntity` supports test doubles without changing production validation.

## Provenance gate (RUNTIME-28)

The facade is the production-facing write boundary for future capture/consolidation. It requires traceable provenance before persistence when the target schema has an appropriate lineage surface:

| Kind | Required provenance surface |
|------|-----------------------------|
| `episodic-frame` | non-blank `provenance.transform_id` |
| `runtime-preference-candidate` | at least one non-blank `source_signal_ids` entry |
| `runtime-crystal-candidate` | non-blank `source_signal_ids` or `lineage.transform_id` |
| `unresolved-decision` | at least one non-blank `provenance` ref |
| `current-decision-leaning` | non-blank `source_signal_id` |
| `harness-operational-state` | at least one non-blank `source_signal_ids` entry |

`rejected-signal-log` and `dormant-snapshot` are exempt because their schemas already carry specialized audit/snapshot lineage and they are not normal production capture outputs. Low-level storage tests may still use `RuntimeStore.semanticEntityInsert` or `writeRuntimeSemanticEntity`; new production writers should use the facade.

---

## Boundary discipline

**In scope for callers of the facade:**

- `RuntimeStore`
- Typed capture/write inputs and results

**Out of scope (must not be imported by `capture-facade.ts`):**

- CLI bootstrap / Commander wiring
- Projection materialization (`createProjectionRenderSource`, `materializeRuntimeProjectionFromSource`)
- gbrain / knowledge SSA adapters

Future consolidation should open a store, create the facade, and call named capture methods — not call `RuntimeStore.semanticEntityInsert` directly.

---

## CLI wiring decision

`amp runtime correct` and `amp runtime seed` **use the facade** (`captureExplicitCorrection` / `writeValidatedEntity`).

CLI-specific concerns remain in `runtime.ts`:

- Project bootstrap and `withAmpRuntimeCliStore`
- Scope inference from AMP config
- Default record id and deterministic timestamps
- Human/JSON report formatting

The facade replaces direct `captureRuntimeCorrection` import in the CLI, reducing coupling: new typed captures add a facade method once; CLI and consolidation both call the same entry point.

Low-level modules (`capture-correction.ts`, `storage-writer.ts`) remain for unit tests and single-purpose reuse; **new writers should prefer the facade**.

---

## Falsifiable claims (test gates)

| Claim | Test |
|-------|------|
| Facade correction persists for inspect + projection | `capture-facade.test.ts` |
| Invalid correction fails before storage | `capture-facade.test.ts` |
| Generic write validates and rejects invalid records | `capture-facade.test.ts` |
| Generic facade write rejects missing provenance | `provenance-validation.test.ts`, `capture-facade.test.ts` |
| No queue rows on any facade path | `capture-facade.test.ts` |
| CLI still works through facade | `runtime-correct.test.ts` |

---

## Current limitations

Same as explicit correction contract (RUNTIME-25):

- No LLM classifier or automatic transcript capture
- No consolidation/promotion pipeline
- No queue migration
- No gbrain writes

The facade is a **structural** hook only; it does not expand supported capture types beyond explicit correction + generic validated write.

---

## Code map

| Artifact | Path |
|----------|------|
| Facade | `src/amp/runtime-semantics/capture-facade.ts` |
| Facade tests | `src/amp/runtime-semantics/capture-facade.test.ts` |
| Explicit correction | `src/amp/runtime-semantics/capture-correction.ts` |
| Validated write | `src/amp/runtime-semantics/storage-writer.ts` |
| CLI consumer | `src/amp/cli/runtime.ts`, `src/amp/cli/runtime-seed.ts` |
| Public export | `src/amp/runtime-semantics/index.ts` |
