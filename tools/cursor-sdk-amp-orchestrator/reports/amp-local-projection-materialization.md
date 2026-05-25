# AMP Local Projection Materialization — Wave 15 Report

> **Task:** AMP-PROJ-15 (A–F) — offline DB/runtime-backed projection source + CLI materialization
> **Base:** `ralph/amp-projection-materialization-v2-integrated`
> **Branch stack:** `15a` content model → `15b` local source → `15c` CLI → `15d` E2E → `15f` runtime close → `15e` docs
> **Date:** 2026-05-25
> **Scope:** Documentation and operator guidance for implemented local projection path

---

## Verdict

**Local offline projection materialization is implemented and test-covered.** Operators can dry-run and apply four canonical projection files using `--source local` with explicit `--apply`, in-memory knowledge, and injected `AMP_USER_ROOT`. Read-only gbrain projection (`--source gbrain`) is implemented separately; live dry-run remains **PROVISIONAL** until `AMP_LIVE_GBRAIN=1` (see `amp-gbrain-projection-live-verification.md`). Harness import loading remains out of scope for this wave.

---

## Implementation summary

| Component | Path | Role |
|-----------|------|------|
| Content model | `src/amp/projection/content.ts` | Structured text blocks → markdown bodies |
| Local source | `src/amp/projection/local-source.ts` | Reads `KnowledgeStore` + `RuntimeStore`; `supportsApply: true` |
| Materialization pipeline | `src/amp/projection/materialize.ts` | Load → reconcile → budget → dry-run or atomic apply |
| CLI wiring | `src/amp/cli/projection.ts` | `--source placeholder\|local`, `--dry-run`, `--apply` |
| E2E | `src/amp/integration/projection-local-materialization.test.ts` | Capture, consolidate, dry-run, apply, Invariant 6 |
| Runtime lifecycle | `src/amp/cli/projection.ts` (15f) | `RuntimeStore.close()` in `finally` after materialize |

---

## Operator commands (safe)

Replace temp paths with your own. **Do not use real `~/.amp` in tests.**

```bash
# Offline acceptance gate
npm run amp:acceptance

# Prepare project
TMP_PROJECT=$(mktemp -d)
TMP_AMP_ROOT=$(mktemp -d)
amp init --project-root "$TMP_PROJECT"

# Local dry-run (plan four writes, no disk)
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
amp projection render --source local --dry-run --project-root "$TMP_PROJECT"

# Local apply (explicit offline materialization)
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
amp projection render --source local --apply --project-root "$TMP_PROJECT"

# Placeholder dry-run (no store reads)
amp projection render --dry-run --project-root "$TMP_PROJECT"
```

---

## Behavior matrix

| Scenario | Expected | Label |
|----------|----------|-------|
| `amp projection render --dry-run` | Plans 4 paths, no writes | **VERIFIED** |
| `amp projection render` (default) | Placeholder apply blocked | **VERIFIED** |
| `--source local --dry-run` + in-memory | Plans 4 paths from stores | **VERIFIED** |
| `--source local --apply` + in-memory | Writes 4 files atomically | **VERIFIED** |
| `--source local` without in-memory | Error → suggest placeholder dry-run | **VERIFIED** |
| `--source gbrain --dry-run` (fake/offline tests) | Plans 4 paths via readonly gbrain adapter | **VERIFIED** |
| `--source gbrain` live dry-run | Opt-in `AMP_LIVE_GBRAIN=1` only | **PROVISIONAL** |
| Claude/Cursor/Codex agent setup (Wave 16+) | Implemented separately | **VERIFIED** — see `amp-local-agent-setup.md` |
| Cross-CLI durable in-memory knowledge | Not solved | **PROVISIONAL** gap |
| Truncation by priority (spec §4.2.3) | Budget gate only; no priority drop | **PROVISIONAL** |
| Token estimates | char/4 heuristic on blocks | **PROVISIONAL** |

---

## Invariant 6

- Project files: `<project>/.amp/local/projection.md`, `<project>/.amp/local/runtime.md`
- Global files: `$AMP_USER_ROOT/projection/global.md`, `$AMP_USER_ROOT/runtime/global.md`
- `amp init` adds `.amp/local/` and `.amp/runtime/` to `.gitignore`
- E2E asserts `git status --short --untracked-files=all` lists no AMP-managed paths

**VERIFIED:** `src/amp/integration/projection-local-materialization.test.ts`, INV-6 conformance mapping

---

## Test injection pattern (full local E2E)

CLI cross-invocation cannot yet share in-memory knowledge. Automated E2E therefore:

1. Uses `runAmpCapture` + `consolidateNow` in-process
2. Passes `knowledgeStore: InMemoryKnowledgeStore` into `runAmpProjectionRender`
3. Sets `AMP_USER_ROOT` in env and rejects real homedir in tests

**VERIFIED:** integration test source

---

## Spec alignment notes

| Spec claim | Implementation (Wave 15) | Action |
|------------|--------------------------|--------|
| §12.6 `amp init` emits initial projection files | Init creates dirs + gitignore; materialization is separate CLI step | Spec footnote added |
| §4.2.3 truncation priority | Metadata budget + hard fail; priority drop not implemented | Documented as **PROVISIONAL** |
| DB-backed / gbrain projection source | Not wired; placeholder apply blocked | Matches `DB_BACKED_MATERIALIZATION_NOT_WIRED` message |

---

## Verification (Wave 15E)

```bash
npm run amp:acceptance
# PASS — exit 0

git diff --check ralph/amp-projection-materialization-v2-integrated..HEAD
# clean (whitespace)
```

Scoped tests for projection wave:

```bash
node --import tsx --test src/amp/projection/*.test.ts
node --import tsx --test src/amp/cli/projection.test.ts
node --import tsx --test src/amp/integration/projection-local-materialization.test.ts
```

---

## Residual risks

1. **Process-local knowledge** — Operators expecting `amp consolidate --knowledge in-memory` followed by a separate `amp projection render` shell command will see empty projection bodies unless runtime queue items remain.
2. **PROVISIONAL token budget** — Combined cap enforcement exists; intelligent truncation and accurate token counts are not production-ready.
3. **Agent setup is a separate step** — Materialized files exist on disk after projection apply; use `amp agent setup` to wire Claude/Cursor/Codex harness surfaces (live load verified separately; not part of acceptance gate).
4. **Global path override** — Forgetting `AMP_USER_ROOT` in tests writes under real `~/.amp` (default homedir behavior).

---

## Ready for merge

**Yes** — Wave 15 local projection path is documented, acceptance-gated, and Invariant 6-safe when operators follow `AMP_USER_ROOT` injection for global paths.
