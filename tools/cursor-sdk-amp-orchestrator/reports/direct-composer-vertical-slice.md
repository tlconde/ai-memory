# AMP Vertical Slice — Direct Composer Report

> **Author:** Cursor Composer 2.5 (direct fallback)  
> **Date:** 24 May 2026  
> **Status:** Advisory — orchestrator must accept or reject before Ralph loops  
> **Scope:** Smallest falsifiable proof of substrate value; no broadening beyond Cursor + Claude Code filesystem adapters

---

## Executive summary

The vertical slice proves one claim:

> A **project-scoped preference** created from a Cursor-style surface is captured as an AMP frame, queued in the runtime store, consolidated into the knowledge store, and retrieved through a Claude Code-style surface — with **Invariant 1 (scope never inferred upward)** and **Invariant 4 (`from-amp` path isolation)** enforced by tests.

Greenfield AMP code does not exist in this repo yet. The existing `@radix-ai/ai-memory` package (`src/`, Node ≥20, `node --import tsx --test`) is a separate compound-memory MCP layer. AMP should land as an isolated namespace that reuses repo tooling without coupling to LongMemEval or `.ai/` memory paths.

**Recommended code root:** `src/amp/` (not top-level `amp/`). The current `tsconfig.json` sets `rootDir: "./src"` and `include: ["src/**/*"]`. A sibling `amp/` package would require a second build graph before the slice is proven.

**Recommended knowledge backend for the slice:** in-memory or raw-fs SSA — **not** gbrain MCP. gbrain is the v1 reference backend (Phase 1); the slice only needs `write`, `read`, `list`, and honest `capabilities()`.

---

## 1. Smallest implementation sequence

Each step depends on the previous. Do not start harness adapters until path-safety and schema tests exist. Do not wire E2E until consolidation is callable synchronously in tests.

| Step | Deliverable | Why this order |
|------|-------------|----------------|
| **0** | Branch `ralph/amp-vertical-slice`; AMP-only commits; exclude LongMemEval dirty files | Isolates scope per `AMP_VERTICAL_SLICE_GOAL.md` |
| **1** | `src/amp/` scaffold: `core/`, `adapter-contract/`, `substrate/storage/`, `adapters/sas/`, `conformance/` | Establishes module boundaries from implementation guide without implementing behavior |
| **2** | Frame schema (Zod) + `AmpError` JSON-RPC envelope + capability-coverage parser | Wire protocol is the contract everything else implements |
| **3** | Runtime store: SQLite, configurable path (`AMP_RUNTIME_PATH` or equivalent), queue push/pop/peek, get/set/delete | Episodic ingest lands here first |
| **4** | Minimal knowledge-store adapter (in-memory or temp-dir raw-fs): `write`, `read`, `list`, `capabilities` | Consolidation needs a write target; gbrain deferred |
| **5** | Scope gate: project → user promotion requires explicit confirmation frame (Invariant 1) | Must exist before any ingest path |
| **6** | Minimal consolidation (sync, test-only): drain runtime episodic queue → infer/write semantic frame → clear runtime entries | Full 9-step pipeline deferred; slice needs drain → write → clear only |
| **7** | Path-safety module: resolve paths, reject `..`, symlinks escaping root, writes outside allowed `from-amp/` roots | Shared by both SAS adapters |
| **8** | `sas-files/cursor.yaml` + Cursor adapter skeleton: read boundaries, write-only under `.cursor/rules/from-amp/` | Proves Invariant 4 for Cursor |
| **9** | `sas-files/claude-code.yaml` + Claude Code adapter skeleton: write-only under `<base>/from-amp/<skill>/` | Proves Invariant 4 for Claude Code |
| **10** | Ingest contract: `capturePreference({ surface: 'cursor', scope, content, projectRef })` → runtime queue | Simulates Cursor-style capture without mutating user `.mdc` files |
| **11** | Retrieval contract: `retrievePreference({ surface: 'claude-code', scope, projectRef, query })` → knowledge store | Simulates Claude Code-style read without requiring a live Claude Code session |
| **12** | E2E integration test wiring steps 10 → 6 → 11 | Falsifies or confirms the slice claim |
| **13** | Conformance ID registry mapping five invariants to test names | Makes Invariant 5 auditable in CI |

### Explicitly deferred (stop before these)

- gbrain MCP SSA, hybrid retrieval, embeddings, graph traversal
- Inference sub-layer learning, correction corpus, training cron
- Propagation cron, procedural registry, `.mdc` / `SKILL.md` compilers (adapters prove path isolation via skeleton write guards; compiler emit is not on the E2E critical path)
- Remote MCP (Shape B), briefing generator, profile slot registry
- Codex, Gemini, Windsurf adapters
- Full consolidation pipeline (entity extract, edge wiring, decay, manifest)

### Module boundaries (proposed)

```
src/amp/
├── core/                    # frame-schema, errors, operations types
├── adapter-contract/        # AdapterContract interface, CapabilityCoverage
├── substrate/
│   └── storage/
│       ├── runtime-store.ts
│       ├── knowledge-store.ts   # interface
│       └── consolidation-minimal.ts
├── adapters/
│   ├── ssa/raw-fs/          # slice-only backend
│   └── sas/
│       ├── cursor/
│       └── claude-code/
├── path-safety/             # from-amp guard (shared)
└── conformance/             # invariant ID → test map

sas-files/
├── cursor.yaml
└── claude-code.yaml

ssa-files/
└── raw-fs.yaml              # slice-only; gbrain.yaml stub OK, not wired
```

---

## 2. First five tests to write

Write these **before** the E2E test. Each maps to a falsifiable acceptance criterion from `AMP_VERTICAL_SLICE_GOAL.md`.

| # | Test file (proposed) | Claim | Invariant / acceptance |
|---|----------------------|-------|------------------------|
| **1** | `src/amp/core/frame-schema.test.ts` | Valid frame round-trips with `kind`, `scope`, `curation_mode`, provenance, and embedded schema version preserved | Acceptance test 1 |
| **2** | `src/amp/core/scope-gate.test.ts` | Project-scoped frame cannot become user-scoped without an explicit confirmation operation recorded as a separate frame | Invariant 1; acceptance test 2 |
| **3** | `src/amp/substrate/storage/runtime-isolation.test.ts` | Runtime keys and queue items never receive `curation_mode` and are not written to the knowledge store by runtime APIs alone | Acceptance test 3 |
| **4** | `src/amp/adapters/sas/cursor/path-safety.test.ts` | Cursor adapter rejects any resolved write path outside `.cursor/rules/from-amp/` (including `..` and symlink escape) | Invariant 4; acceptance test 4 |
| **5** | `src/amp/integration/preference-vertical-slice.test.ts` | Cursor-style scoped preference → runtime queue → synchronous consolidation → Claude Code-style retrieval returns the same content at project scope | Acceptance test 7 (E2E) |

**Verification command (all five):**

```bash
npm run typecheck && npm test -- src/amp/
```

After task 1 (scaffold), test 1 should be the first commit that adds real behavior.

---

## 3. Ambiguous contracts — resolve before coding

These ambiguities will produce incompatible Ralph commits if left implicit. The orchestrator should lock answers in a short ADR or in `specs/tasks.md` on the Ralph branch.

### 3.1 Blocking (must resolve in preflight)

| ID | Ambiguity | Options | Recommendation |
|----|-----------|---------|----------------|
| **C1** | Code root | `src/amp/` vs top-level `amp/` vs separate package | **`src/amp/`** — matches existing `tsconfig.json` and test runner |
| **C2** | Slice knowledge backend | in-memory, raw-fs temp dir, gbrain MCP | **in-memory or temp raw-fs** — gbrain is Phase 1, not slice-critical |
| **C3** | “Cursor-style preference” ingest shape | (a) programmatic API only in tests, (b) read a fixture `.mdc`, (c) parse user rules | **(a) programmatic API** with optional fixture for documentation — do not read user-authored `.cursor/rules/` in v0 |
| **C4** | “Claude Code-style retrieval” shape | (a) knowledge `search()`/`read()`, (b) read emitted file under `from-amp/`, (c) MCP tool | **(a) knowledge store read/search** — filesystem emit is path-guard tested separately; E2E does not require Claude Code runtime |
| **C5** | Consolidation invocation in tests | synchronous `consolidateNow()` vs daemon cron | **`consolidateNow()`** exported for tests; cron wrapper deferred |
| **C6** | Claude Code `from-amp` base | project `.claude/skills/from-amp/` vs user `~/.claude/skills/from-amp/` | **project-local default** for slice tests (`mkdtemp` project root); SAS documents both, adapter accepts `basePath` param |
| **C7** | Runtime queue item schema | opaque JSON vs typed `EpisodicSignal` | **Typed `EpisodicSignal`** with `content`, `scope`, `projectRef`, `source`, `surface` — maps 1:1 to frame fields after consolidation |
| **C8** | Scope promotion confirmation | separate episodic frame vs explicit `mutate` op with audit | **Separate confirmation frame** per spec Invariant 1 |

### 3.2 Important but deferrable within slice

| ID | Ambiguity | Notes |
|----|-----------|-------|
| **C9** | Frame `schema_version` field name and default | Lock in frame-schema.ts; default `"1.0"` unless spec amends |
| **C10** | SAS `injection_modes` declaration for filesystem-native | Slice adapters are filesystem-native only; declare `[filesystem-native]` honestly |
| **C11** | Cursor `.mdc` flat file vs subfolder | Spec §9.4: **flat** `.cursor/rules/from-amp/SKILL_NAME.mdc` — **PROVISIONAL** until load test in target Cursor version |
| **C12** | Bun vs Node runtime | Implementation guide mentions Bun; repo uses **Node ≥20** — treat Node as **VERIFIED**, Bun as **UNKNOWN** for this repo |
| **C13** | Procedural compiler in slice | Path guards yes; full canonical→emit compiler **no** on E2E path — defer to post-slice unless orchestrator expands scope |

### 3.3 External tool behavior labels

| Claim | Label | Evidence |
|-------|-------|----------|
| Cursor rules live under `.cursor/rules/` with `.mdc` extension | **VERIFIED** | Spec §9.4; this workspace loads `.cursor/rules/*.mdc` |
| Cursor loads `.cursor/rules/from-amp/*.mdc` on session start | **PROVISIONAL** | Spec assertion; not tested in this repo's CI |
| Cursor frontmatter fields: `description`, `globs`, `alwaysApply` | **VERIFIED** | Spec §9.3; active workspace rules use same shape |
| Claude Code loads `SKILL.md` under skills directories | **PROVISIONAL** | Spec §9.4; Agent Skills standard adopted widely but not exercised here |
| Claude Code reads `<base>/from-amp/<skill>/SKILL.md` | **PROVISIONAL** | Spec placement table; local load test not yet run |
| gbrain MCP as reference SSA | **PROVISIONAL** | Documented reference; not wired in ai-memory repo |
| Codex / Gemini / Windsurf adapter placement | **UNKNOWN** | Explicitly out of scope |

---

## 4. Ralph-ready atomic task list

**Branch preflight:**

```bash
git switch -c ralph/amp-vertical-slice
git config core.hooksPath .githooks
```

Do not stage or commit changes under `benchmarks/longmemeval/`. If root `specs/` belongs to another workstream, copy AMP tasks to a dedicated worktree or AMP-only `specs/` on this branch only.

Each task = **one commit**. Verification runs from repo root.

---

### Task 01 — AMP namespace scaffold

**Files:** `src/amp/index.ts`, barrel exports, empty module dirs per boundary table above  
**Commit message:** `feat(amp): scaffold vertical-slice module layout`  
**Verify:** `npm run typecheck`

---

### Task 02 — Frame schema + round-trip test

**Files:** `src/amp/core/frame-schema.ts`, `src/amp/core/frame-schema.test.ts`  
**Commit message:** `feat(amp): add frame schema with round-trip validation`  
**Verify:** `npm test -- src/amp/core/frame-schema.test.ts`

---

### Task 03 — JSON-RPC error envelope

**Files:** `src/amp/core/errors.ts`, `src/amp/core/errors.test.ts`  
**Commit message:** `feat(amp): add JSON-RPC 2.0 error codes -32001..-32010`  
**Verify:** `npm test -- src/amp/core/errors.test.ts`

---

### Task 04 — Capability coverage parser

**Files:** `src/amp/adapter-contract/capability-coverage.ts`, test file  
**Commit message:** `feat(amp): parse and validate capability_coverage blocks`  
**Verify:** `npm test -- src/amp/adapter-contract/`

---

### Task 05 — Runtime store (SQLite, configurable path)

**Files:** `src/amp/substrate/storage/runtime-store.ts`, tests using `mkdtemp`  
**Commit message:** `feat(amp): add configurable SQLite runtime store and queue primitives`  
**Verify:** `npm test -- src/amp/substrate/storage/runtime-store`

**Env contract:** `AMP_RUNTIME_PATH` overrides default; tests must never touch `~/Library/Application Support/amp/` or `~/.local/share/amp/`.

---

### Task 06 — Minimal knowledge store adapter

**Files:** `src/amp/adapters/ssa/raw-fs/` or `in-memory-store.ts`, `ssa-files/raw-fs.yaml`  
**Commit message:** `feat(amp): add minimal raw-fs knowledge adapter for vertical slice`  
**Verify:** `npm test -- src/amp/adapters/ssa/`

---

### Task 07 — Scope promotion gate (Invariant 1)

**Files:** `src/amp/core/scope-gate.ts`, `scope-gate.test.ts`  
**Commit message:** `feat(amp): enforce scope-never-inferred-upward gate`  
**Verify:** `npm test -- src/amp/core/scope-gate.test.ts`

---

### Task 08 — Runtime / knowledge isolation test

**Files:** `src/amp/substrate/storage/runtime-isolation.test.ts`  
**Commit message:** `test(amp): runtime state never receives curation_mode or knowledge writes`  
**Verify:** `npm test -- src/amp/substrate/storage/runtime-isolation.test.ts`

---

### Task 09 — Minimal consolidation (sync)

**Files:** `src/amp/substrate/storage/consolidation-minimal.ts`, tests  
**Commit message:** `feat(amp): add synchronous drain-queue-to-knowledge consolidation`  
**Verify:** `npm test -- src/amp/substrate/storage/consolidation`

---

### Task 10 — Path-safety module

**Files:** `src/amp/path-safety/guard.ts`, tests for `..`, symlink, prefix mismatch  
**Commit message:** `feat(amp): add from-amp path safety guard`  
**Verify:** `npm test -- src/amp/path-safety/`

---

### Task 11 — Cursor SAS spec + adapter skeleton

**Files:** `sas-files/cursor.yaml`, `src/amp/adapters/sas/cursor/adapter.ts`, path-safety test  
**Commit message:** `feat(amp): add Cursor SAS and from-amp write guard skeleton`  
**Verify:** `npm test -- src/amp/adapters/sas/cursor/`

---

### Task 12 — Claude Code SAS spec + adapter skeleton

**Files:** `sas-files/claude-code.yaml`, `src/amp/adapters/sas/claude-code/adapter.ts`, path-safety test  
**Commit message:** `feat(amp): add Claude Code SAS and from-amp write guard skeleton`  
**Verify:** `npm test -- src/amp/adapters/sas/claude-code/`

---

### Task 13 — Capture + retrieval API

**Files:** `src/amp/substrate/capture-preference.ts`, `retrieve-preference.ts`, unit tests  
**Commit message:** `feat(amp): add cursor-style capture and claude-code-style retrieval APIs`  
**Verify:** `npm test -- src/amp/substrate/capture` (and retrieve)

---

### Task 14 — E2E vertical slice integration test

**Files:** `src/amp/integration/preference-vertical-slice.test.ts`  
**Commit message:** `test(amp): prove preference capture consolidate retrieve e2e`  
**Verify:** `npm test -- src/amp/integration/preference-vertical-slice.test.ts`

---

### Task 15 — Conformance invariant registry

**Files:** `src/amp/conformance/invariant-registry.ts`, `conformance.test.ts` mapping IDs INV-1..INV-5 to tests  
**Commit message:** `test(amp): register conformance IDs for five invariants`  
**Verify:** `npm test -- src/amp/conformance/ && npm test -- src/amp/`

---

### Ralph preflight checklist

- [ ] Branch `ralph/amp-vertical-slice` created from clean base (no LongMemEval files in commits)
- [ ] Orchestrator locked answers for **C1–C8**
- [ ] `specs/tasks.md` on branch lists tasks 01–15 (or subset if orchestrator merges tasks)
- [ ] `npm run typecheck` passes after each commit
- [ ] Full slice verify: `npm test -- src/amp/`

---

## 5. Stop condition

### Success — slice is done

Stop implementation and open for review when **all** of the following are true:

1. `npm run typecheck` passes  
2. `npm test -- src/amp/` passes  
3. All seven acceptance tests from `AMP_VERTICAL_SLICE_GOAL.md` have passing automated coverage  
4. Tasks 01–15 (or orchestrator-approved equivalent) are committed on `ralph/amp-vertical-slice`  
5. No writes occur outside `from-amp/` paths in tests or adapters (Invariant 4)  
6. No dependency on gbrain MCP, remote MCP, or cloud memory surfaces for the E2E path  

### Failure — pause and reassess

Per spec §13.9 and the vertical slice goal **kill criterion**:

> If the E2E preference test (Task 14) is not passing after **two focused implementation weeks** from Task 01 merge, **stop**, document blockers, and reassess whether the substrate abstraction earns its complexity before any Phase 1+ work.

### Scope creep — do not proceed

Halt Ralph loops immediately if a task introduces any of:

- Codex, Gemini, or Windsurf adapters  
- gbrain MCP integration (beyond a stub SSA file)  
- Remote MCP / OAuth gateway  
- Model fine-tuning or inference training cron  
- Full 9-step consolidation pipeline  
- Procedural registry propagation cron  
- Profile slot registry beyond what the E2E test requires  
- Changes to `benchmarks/longmemeval/` or unrelated `.ai/` memory tooling  

---

## Risks that could invalidate the vertical slice

| Risk | Mitigation |
|------|------------|
| Minimal knowledge adapter too unlike real SSA contract | Keep adapter implementing the same `write/read/list/capabilities` surface gbrain will use; add conformance test early |
| Consolidation scope creep | Hard-cap at drain → single semantic frame write → clear queue for v0 |
| Path-safety bypass via symlinks | Test on macOS (`mkdtemp` + symlink fixtures) in Task 10 |
| Cursor/Claude path assumptions wrong | Label **PROVISIONAL**; verify with manual load test post-slice, not during slice |
| Node vs Bun tooling drift | Stay on repo **VERIFIED** Node toolchain; do not introduce Bun-only APIs in slice |

---

*End of report. Composer output is advisory until the orchestrator accepts contract resolutions C1–C8 and the task list.*
