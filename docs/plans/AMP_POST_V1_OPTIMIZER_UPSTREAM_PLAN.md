# AMP Post-v1 Optimizer and Upstream Sync Plan

> **Status:** post-v1 execution roadmap
> **Date:** 2026-05-27
> **Design source:** `docs/specs/AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md`
> **v1 baseline:** `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`

## Implementation status (updated 2026-05-29)

**DONE (shipped, with commits):**
- §11.1 schema-only: capability_coverage gained `skill_optimization` + `action_log` keys; `ProcedureProvenanceSchema` gained optional `upstream` block (commit 8788e42).
- §11.2 §16 upstream-sync skeleton: `amp upstream {subscribe,unsubscribe,list,review,apply,dismiss,poll}`, stub source, changesets, projection block, T1–T5 (commits e706a65, af3b8e9).
- §11.4 §5/§9.9 gstack importer (local-first, no network): `amp procedural {import,revoke,list}`, GstackUpstreamSource, SKILL.md parser (commits 34f0c77, e5eecb4, b5c0e4a, 58089f8).
- §10.4.1 gbrain `graph_traversal: unsupported → wrapped`, live-verified against a real brain (commit eaea475).

**PENDING (not yet built):**
- §11.5 optimizer sub-layer (Eval / Judge / Optimizer / ValidationGate).
- §10.4.2 gbrain `procedural_registry`, §10.4.3 gbrain `vector_search: native`.

## Purpose

This plan turns the optimizer and upstream-sync spec delta into an implementation sequence. It is intentionally post-v1: AMP v1 offline acceptance is already complete, and this work must not change the meaning or exit policy of `npm run amp:acceptance` unless a later promotion plan explicitly says so.

The canonical protocol design remains `docs/specs/AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md`. This document is the operational roadmap for implementing it in small, reviewable waves.

## Current Baseline

- AMP v1 offline acceptance is complete at gate commit `82962bf`; the acceptance record is `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.
- Live gbrain and live harness-session verification remain separate from offline acceptance.
- Optimizer, upstream-sync, gstack import, and gbrain capability promotions are post-v1 work.
- `npm run amp:acceptance` remains a regression gate for the v1 offline proof, not proof that the post-v1 live features work.
- New live gbrain behavior must stay opt-in and outside the default acceptance gate until intentionally promoted.

## Implementation Order

### 1. Schema-only foundation

Add the type surface required by the spec delta without building feature behavior yet.

- Extend `capability_coverage` with `skill_optimization` and optional `action_log`.
- Keep `action_log` unsupported for all current backends; ActiveGraph remains optional-only and unimplemented.
- Extend `ProcedureProvenanceSchema` with optional `provenance.upstream` containing `source_id`, `ref`, `fetched_at`, and `upstream_synced_at`.
- Add schema and conformance tests proving unsupported optional capabilities are reported honestly.
- Verify with `npm run typecheck`, `npm run build`, and targeted tests for `src/amp/adapter-contract/`, `src/amp/ssa/`, and `src/amp/procedural/`.

### 2. Upstream-sync skeleton

Build the generic upstream workflow against a stub fixture source before connecting real projects.

- Add subscription, changeset, review, apply, dismiss, and unsubscribe primitives.
- Add CLI verbs for `amp upstream subscribe/list/review/apply/dismiss/unsubscribe`.
- Render pending changesets into runtime projection files using the `amp:upstream-sync` marker block.
- Ensure apply and dismiss remove the marker block on the next projection render.
- Keep the default path offline: no network, no live gbrain, no real upstream repositories.

### 3. gbrain graph traversal promotion

Promote the smallest high-leverage gbrain capability after the schema and upstream skeleton are stable.

- Emit `[[wikilinks]]` for typed cross-frame references from the gbrain frame codec.
- Add adapter operations for `add_link` and `get_backlinks`.
- Move `graph_traversal` from `unsupported` to `wrapped` only after tests support the claim — DONE 2026-05-29 (commit eaea475), live-verified.
- Keep live verification behind `AMP_LIVE_GBRAIN=1`; do not add live gbrain checks to `npm run amp:acceptance`.

### 4. gstack importer and revoke path

Treat gstack as upstream procedural content, not a vendored fork.

- Import `skills/*/SKILL.md` from a pinned gstack ref into `CanonicalProcedure`.
- Set `provenance.source = "import"` and populate `provenance.upstream.source_id`.
- Validate every imported procedure with `ProcedureFrontmatterSchema`.
- Register atomically, propagate to verified harnesses, and support revoke.
- Preserve locally edited `1.x.x` procedures when `--keep-edited` is used.

### 5. Optimization loop

Implement skill optimization as an AMP substrate sub-layer while allowing gbrain to be the first native backend implementation.

- Use captured corrections as the correction corpus.
- Add Eval/Judge/Optimizer/ValidationGate interfaces.
- Bound proposed edits with the textual learning-rate budget from the spec delta.
- Accept only changes that improve held-out validation.
- Write accepted changes through `ProcedureRegistry.update()` with `provenance.source = "amp-registry"` and `author = "amp-optimizer"`.
- Log rejected proposals without mutating the registry.

### 6. Remaining gbrain promotions

Finish the gbrain capability upgrades once the shared substrate surfaces are stable.

- Add discoverability for gbrain skills via `amp procedural list --source gbrain`; do not auto-import them.
- Promote hybrid query from `wrapped` to `native` only after an opt-in live conformance test proves ordering and result semantics.
- Keep PROVISIONAL claims labeled until their named tests pass.

## Guardrails

- ActiveGraph is a possible future add-on only. AMP does not build, ship, or depend on it.
- Upstream updates are never auto-applied. The user must approve every apply operation.
- High-risk updates require an explicit confirmation flag.
- Live gbrain writes require explicit opt-in or confirmation.
- Network access and live services are not part of default offline gates.
- AMP-managed outputs remain under `.amp/local/`, `~/.amp/`, or harness `from-amp/` roots.
- AMP-managed outputs must remain gitignored and must not appear in `git status`.
- The v1 acceptance report remains factual history; do not turn it into a roadmap.

## Verification Matrix

| Wave | Required verification |
|---|---|
| Schema-only foundation | `npm run typecheck`; `npm run build`; targeted tests for adapter contract, SSA loading, and procedure schema |
| Upstream-sync skeleton | Targeted unit/integration tests for fixture upstream detection, projection marker rendering, apply, dismiss, conflict refusal, and token-budget behavior |
| gbrain graph traversal | gbrain adapter/frame-codec tests; opt-in live test behind `AMP_LIVE_GBRAIN=1` |
| gstack importer | Fixture repo import/revoke tests; propagation readback tests; path-safety tests |
| Optimization loop | Optimizer vertical-slice fixture with accepted improvement and rejected proposal audit |
| Remaining gbrain promotions | Opt-in live tests for gbrain procedural discovery and hybrid query semantics |

Always run `npm run amp:acceptance` as a v1 regression check after substantive AMP changes. Passing it does not prove post-v1 live behavior.

## Worker Handoff

Start with the schema-only foundation. That first PR owns only the schema/type surface and tests:

- `src/amp/adapter-contract/**`
- `src/amp/ssa/**`
- `src/amp/procedural/**`
- `ssa-files/*.yaml` if needed for capability defaults
- related tests only

Do not begin the upstream-sync skeleton until the schema-only foundation is merged and green.
