# AMP v1 Ralph Tasks

> **Base:** `ralph/amp-v1` after Barrier 0.  
> **Rule:** one task per commit unless the task explicitly says otherwise.  
> **Evaluator:** Codex.  
> **Workers:** Cursor Composer 2.5 and Ralph loops.

## Preflight for Every Worker

```bash
git branch --show-current
npm run typecheck
npm run build
npm test -- src/amp/
```

Do not continue if the branch is dirty except for the files owned by the task.

## Lane A — Contracts and Config

- [ ] **V1-01 — AMP config schema and discovery**
  - Owns: `src/amp/config/**`, `src/amp/index.ts`, tests.
  - Build: project config plus user config resolution; runtime path defaults for macOS/Linux; test override path.
  - Verify: `npm test -- src/amp/config/ && npm run typecheck`.
  - Commit: `feat(amp): add v1 config discovery`.

- [ ] **V1-02 — SSA/SAS schema loaders**
  - Owns: `src/amp/ssa/**`, `src/amp/sas/**`, `ssa-files/*.yaml`, `sas-files/*.yaml`, tests.
  - Build: YAML loading, Zod validation, external claim label field, capability coverage parsing integration.
  - Verify: `npm test -- src/amp/ssa/ src/amp/sas/ && npm run typecheck`.
  - Commit: `feat(amp): validate SSA and SAS specs`.

- [ ] **V1-03 — Adapter contract hardening**
  - Owns: `src/amp/adapter-contract/**`, tests.
  - Build: role declaration, operation result types, unsupported capability errors, transaction contract shape.
  - Verify: `npm test -- src/amp/adapter-contract/ && npm run typecheck`.
  - Commit: `feat(amp): harden adapter contract for v1`.

- [ ] **V1-04 — Conformance runner**
  - Owns: `src/amp/conformance/**`, tests.
  - Build: executable conformance runner with invariant IDs and adapter-targeted suites.
  - Verify: `npm test -- src/amp/conformance/ && npm run typecheck`.
  - Commit: `test(amp): add v1 conformance runner`.

- [ ] **V1-05 — Correction frame and deterministic feedback schema**
  - Owns: `src/amp/core/**`, `src/amp/substrate/inference/**`, tests.
  - Build: correction frame helpers and per-user deterministic override table shape; no fine-tuning.
  - Verify: `npm test -- src/amp/core/ src/amp/substrate/inference/ && npm run typecheck`.
  - Commit: `feat(amp): add deterministic correction feedback schema`.

- [ ] **V1-06 — Shared curation mode guardrails**
  - Owns: `src/amp/core/**`, tests.
  - Build: explicit promotion/demotion helpers for `shared`; no automatic promotion.
  - Verify: `npm test -- src/amp/core/ && npm run typecheck`.
  - Commit: `feat(amp): enforce shared curation guardrails`.

## Lane B — Storage / gbrain

- [ ] **V1-07 — gbrain transport spike report**
  - Owns: `docs/plans/AMP_GBRAIN_SPIKE.md` or `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-spike.md`.
  - Build: verify actual local gbrain integration path: MCP, CLI, direct DB, or existing ai-memory API.
  - Verify: report includes exact command/output and labels each claim.
  - Commit: `docs(amp): record gbrain adapter transport decision`.

- [ ] **V1-08 — gbrain SSA spec**
  - Depends: V1-02, V1-07.
  - Owns: `ssa-files/gbrain.yaml`, tests.
  - Build: declared capability coverage with unsupported features marked honestly.
  - Verify: `npm test -- src/amp/ssa/ && npm run typecheck`.
  - Commit: `feat(amp): add gbrain SSA spec`.

- [ ] **V1-09 — gbrain adapter read/write/list**
  - Depends: V1-03, V1-08.
  - Owns: `src/amp/adapters/ssa/gbrain/**`, tests.
  - Build: write/read/list against verified transport; fake transport allowed only with parity tests and explicit naming.
  - Verify: `npm test -- src/amp/adapters/ssa/gbrain/ && npm run typecheck`.
  - Commit: `feat(amp): add gbrain knowledge adapter`.

- [ ] **V1-10 — gbrain search and capability conformance**
  - Depends: V1-04, V1-09.
  - Owns: `src/amp/adapters/ssa/gbrain/**`, `src/amp/conformance/**`, tests.
  - Build: search behavior for supported modes; unsupported modes return AMP capability errors.
  - Verify: `npm test -- src/amp/adapters/ssa/gbrain/ src/amp/conformance/`.
  - Commit: `test(amp): verify gbrain adapter conformance`.

- [ ] **V1-11 — gbrain-backed consolidation**
  - Depends: V1-09.
  - Owns: `src/amp/substrate/consolidation/**`, `src/amp/substrate/storage/**`, tests.
  - Build: queue-to-gbrain consolidation with durable remove-after-write semantics.
  - Verify: `npm test -- src/amp/substrate/ src/amp/adapters/ssa/gbrain/`.
  - Commit: `feat(amp): consolidate runtime signals into gbrain`.

## Lane C — Harness Adapters

- [ ] **V1-12 — Hermes placement spike report**
  - Owns: `docs/plans/AMP_HERMES_SPIKE.md` or `tools/cursor-sdk-amp-orchestrator/reports/amp-hermes-spike.md`.
  - Build: verify Hermes local skill/rule paths, load behavior, and safe write target.
  - Verify: report includes exact repo paths, commands, and claim labels.
  - Commit: `docs(amp): record Hermes adapter placement decision`.

- [ ] **V1-13 — Hermes SAS spec**
  - Depends: V1-02, V1-12.
  - Owns: `sas-files/hermes.yaml`, tests.
  - Build: capability coverage and injection modes for Hermes only after verification.
  - Verify: `npm test -- src/amp/sas/ && npm run typecheck`.
  - Commit: `feat(amp): add Hermes SAS spec`.

- [ ] **V1-14 — Hermes filesystem adapter**
  - Depends: V1-03, V1-13.
  - Owns: `src/amp/adapters/sas/hermes/**`, tests.
  - Build: read AMP-managed artifacts, write emitted artifacts only under Hermes `from-amp/`.
  - Verify: `npm test -- src/amp/adapters/sas/hermes/ && npm run typecheck`.
  - Commit: `feat(amp): add Hermes filesystem adapter`.

- [ ] **V1-15 — Cursor adapter real emission behavior**
  - Depends: V1-03.
  - Owns: `src/amp/adapters/sas/cursor/**`, tests.
  - Build: write deterministic `.mdc` files from compiled artifacts; read AMP-managed `.mdc`; preserve path safety.
  - Verify: `npm test -- src/amp/adapters/sas/cursor/ src/amp/path-safety/`.
  - Commit: `feat(amp): emit Cursor rules from canonical artifacts`.

- [ ] **V1-16 — Claude Code adapter real emission behavior**
  - Depends: V1-03.
  - Owns: `src/amp/adapters/sas/claude-code/**`, tests.
  - Build: write folder-per-skill `SKILL.md` under selected `from-amp/` root; read AMP-managed skills.
  - Verify: `npm test -- src/amp/adapters/sas/claude-code/ src/amp/path-safety/`.
  - Commit: `feat(amp): emit Claude Code skills from canonical artifacts`.

## Lane D — Procedures and Propagation

- [ ] **V1-17 — Canonical procedure schema**
  - Owns: `src/amp/procedural/**`, tests.
  - Build: canonical AMP procedure source schema with provenance, compatibility, overlays, conflicts.
  - Verify: `npm test -- src/amp/procedural/ && npm run typecheck`.
  - Commit: `feat(amp): add canonical procedure schema`.

- [ ] **V1-18 — Cursor `.mdc` compiler**
  - Depends: V1-15, V1-17.
  - Owns: `src/amp/procedural/**`, `src/amp/adapters/sas/cursor/**`, tests.
  - Build: canonical procedure to Cursor frontmatter/body; deterministic formatting.
  - Verify: `npm test -- src/amp/procedural/ src/amp/adapters/sas/cursor/`.
  - Commit: `feat(amp): compile procedures to Cursor rules`.

- [ ] **V1-19 — SKILL.md compiler**
  - Depends: V1-16, V1-17.
  - Owns: `src/amp/procedural/**`, `src/amp/adapters/sas/claude-code/**`, tests.
  - Build: canonical procedure to folder-per-skill `SKILL.md`; deterministic formatting.
  - Verify: `npm test -- src/amp/procedural/ src/amp/adapters/sas/claude-code/`.
  - Commit: `feat(amp): compile procedures to SKILL.md`.

- [ ] **V1-20 — Procedure registry**
  - Depends: V1-17.
  - Owns: `src/amp/procedural/**`, tests.
  - Build: registry CRUD, version metadata, conflicts, last synced timestamps.
  - Verify: `npm test -- src/amp/procedural/ && npm run typecheck`.
  - Commit: `feat(amp): add procedure registry`.

- [ ] **V1-21 — Propagation service**
  - Depends: V1-14, V1-18, V1-19, V1-20.
  - Owns: `src/amp/substrate/propagation/**`, `src/amp/procedural/**`, tests.
  - Build: compile and write artifacts to verified harness `from-amp/` roots; never touch user-authored paths.
  - Verify: `npm test -- src/amp/substrate/propagation/ src/amp/procedural/ src/amp/path-safety/`.
  - Commit: `feat(amp): propagate procedures to verified harnesses`.

## Lane E — CLI and Installability

- [ ] **V1-22 — AMP CLI command group**
  - Depends: V1-01.
  - Owns: `src/cli/**`, `src/amp/cli/**`, tests.
  - Build: `ai-memory amp` or `amp` command routing without breaking existing CLI behavior.
  - Verify: `npm test -- src/cli/ src/amp/cli/ && npm run build`.
  - Commit: `feat(amp): add CLI command group`.

- [ ] **V1-23 — `amp init`**
  - Depends: V1-22.
  - Owns: `src/amp/cli/**`, fixtures/tests.
  - Build: create project-local AMP config and safe directories; do not write harness files.
  - Verify: CLI fixture test plus `npm run typecheck`.
  - Commit: `feat(amp): add project init command`.

- [ ] **V1-24 — `amp doctor`**
  - Depends: V1-02, V1-03, V1-22.
  - Owns: `src/amp/cli/**`, tests.
  - Build: inspect config, runtime, SSA/SAS, path roots, capability gaps, and report actionable findings.
  - Verify: CLI fixture test plus `npm run typecheck`.
  - Commit: `feat(amp): add doctor command`.

- [ ] **V1-25 — capture/consolidate/retrieve commands**
  - Depends: V1-11, V1-22.
  - Owns: `src/amp/cli/**`, tests.
  - Build: command wrappers around capture, consolidation, and retrieval APIs.
  - Verify: CLI fixture test plus `npm test -- src/amp/substrate/`.
  - Commit: `feat(amp): add capture consolidate retrieve commands`.

- [ ] **V1-26 — propagate command**
  - Depends: V1-21, V1-22.
  - Owns: `src/amp/cli/**`, tests.
  - Build: compile and propagate registry artifacts to selected verified harnesses.
  - Verify: CLI fixture test plus propagation tests.
  - Commit: `feat(amp): add procedure propagation command`.

## Lane F — E2E and Release Candidate

- [ ] **V1-27 — v1 fixture project**
  - Owns: `src/amp/integration/fixtures/**`, tests.
  - Build: isolated fixture with project config, temp runtime, fake or local gbrain mode, harness roots.
  - Verify: `npm test -- src/amp/integration/`.
  - Commit: `test(amp): add v1 fixture project`.

- [ ] **V1-28 — gbrain + harness E2E**
  - Depends: V1-11, V1-14 or V1-15 or V1-16, V1-27.
  - Owns: `src/amp/integration/**`, tests.
  - Build: capture -> runtime -> consolidate -> gbrain -> retrieve via verified harness adapter.
  - Verify: `npm test -- src/amp/integration/ && npm run typecheck`.
  - Commit: `test(amp): prove gbrain-backed harness retrieval`.

- [ ] **V1-29 — procedure propagation E2E**
  - Depends: V1-21, V1-27.
  - Owns: `src/amp/integration/**`, tests.
  - Build: canonical procedure -> compiler -> selected harness `from-amp/` artifact -> readback.
  - Verify: `npm test -- src/amp/integration/ src/amp/procedural/`.
  - Commit: `test(amp): prove procedure propagation e2e`.

- [ ] **V1-30 — acceptance script**
  - Depends: V1-28, V1-29.
  - Owns: `scripts/amp-v1-acceptance.mjs` or `src/amp/conformance/**`, package script if needed.
  - Build: one command that runs the v1 acceptance gate.
  - Verify: acceptance command plus `npm test`.
  - Commit: `test(amp): add v1 acceptance gate`.

- [ ] **V1-31 — docs from implementation**
  - Depends: V1-30.
  - Owns: AMP docs only.
  - Build: update spec/guide/plan with verified behavior; mark remaining provisional claims.
  - Verify: exhaustive reference check for AMP terms and doc validation if available.
  - Commit: `docs(amp): update v1 implementation docs`.

## Merge Order

1. V1-01 through V1-06.
2. V1-07 through V1-11 and V1-12 through V1-16 in parallel after contracts.
3. V1-17 through V1-21 in parallel with CLI after config/path roots are frozen.
4. V1-22 through V1-26.
5. V1-27 through V1-31.

## Scope Creep Halt List

Stop immediately if a task attempts:

- Remote MCP gateway.
- Cloud vendor memory writes.
- Codex/Gemini/Windsurf adapter implementation without direct verification.
- Multi-device sync.
- Multi-store federation.
- Model fine-tuning.
- Writes outside `from-amp/`.
- `.ai/` memory edits in a code PR.

