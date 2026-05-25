# AMP Local Testing — Operator Guide

> **Audience:** Operators and contributors running AMP offline on a laptop or in CI
> **Scope:** Local projection materialization (Wave 15), Invariant 6 safety, and acceptance gates
> **Companion:** `docs/specs/AMP_CONSOLIDATED_SPEC.md` §4.2.1, §12.6

---

## What this guide covers

AMP v1 ships an **offline local projection path** that materializes four markdown projection files from:

- **Runtime store** — SQLite queue/KV at `<project>/.amp/runtime/` (working memory)
- **Knowledge store** — in-memory backend for tests; live gbrain for consolidate/retrieve (not for projection source in Wave 15)

This guide explains how to dry-run and apply projections safely without touching real `~/.amp` or git-tracking AMP-managed artifacts.

---

## Safety defaults

| Rule | Why |
|------|-----|
| Set `AMP_USER_ROOT` to a temp directory | Global projection files resolve under `AMP_USER_ROOT`, not necessarily `~/.amp` |
| Run `ai-memory amp init` before projection commands | Creates `.amp/local/`, `.amp/runtime/`, and gitignore entries (Invariant 6) |
| Never rely on real `~/.amp` in tests | Integration tests inject `AMP_USER_ROOT` and reject real homedir resolution |
| Project-local outputs live under `.amp/local/` | Gitignored by `ai-memory amp init`; must not appear in `git status` |

**VERIFIED:** Invariant 6 tests and `src/amp/integration/projection-local-materialization.test.ts` enforce git cleanliness for AMP-managed paths.

---

## Projection materialization modes

| Mode | Command shape | Writes disk? | Source | Status |
|------|---------------|--------------|--------|--------|
| Placeholder dry-run | `ai-memory amp projection render --dry-run` | No | Fixture documents only | **VERIFIED** |
| Placeholder apply | `ai-memory amp projection render` (no flags) | No — blocked | Placeholder refuses apply | **VERIFIED** |
| Local dry-run | `--source local --dry-run` + `AMP_KNOWLEDGE_BACKEND=in-memory` | No | Runtime DB + in-memory knowledge | **VERIFIED** |
| Local apply | `--source local --apply` + `AMP_KNOWLEDGE_BACKEND=in-memory` | Yes (four files) | Runtime DB + in-memory knowledge | **VERIFIED** |

### Explicit apply is required

Local apply **always** requires both flags:

```bash
--source local --apply
```

Default behavior without `--dry-run` attempts apply mode. Placeholder source blocks apply with `DB-backed projection materialization is not wired yet.` Local source without an offline knowledge backend fails with a message suggesting `--source placeholder --dry-run`.

**VERIFIED:** `src/amp/cli/projection.test.ts`

---

## What is NOT implemented (Wave 15)

| Capability | Status |
|------------|--------|
| Live gbrain projection source | **Not implemented** — projection render never uses live gbrain |
| Live Claude/Cursor/Hermes import loading | **Not implemented** — no harness `@import` wiring in this wave |
| Durable cross-CLI in-memory knowledge | **Not solved** — `AMP_KNOWLEDGE_BACKEND=in-memory` is process-local; separate shell invocations do not share knowledge unless you consolidate in-process or inject stores in tests |
| Priority-based truncation | **PROVISIONAL** — budget metadata and hard-cap gate exist; dropping content by truncation priority (spec §4.2.3) is unfinished |
| Token counting accuracy | **PROVISIONAL** — block `tokenEstimate` uses a deterministic char/4 heuristic; not a production tokenizer |

---

## Canonical projection paths

| Kind | Path (with `AMP_USER_ROOT` override for global) |
|------|--------------------------------------------------|
| Global projection | `$AMP_USER_ROOT/projection/global.md` |
| Global runtime | `$AMP_USER_ROOT/runtime/global.md` |
| Project projection | `<project>/.amp/local/projection.md` |
| Project runtime | `<project>/.amp/local/runtime.md` |

When `AMP_USER_ROOT` is unset, global paths default to `~/.amp/...` (**avoid in tests**).

---

## Recommended local workflow

The package exposes AMP as a subcommand: `ai-memory amp <command>`. Examples below assume you run from the repo root after `npm run build` (or use `npx ai-memory` / `node dist/cli/index.js`).

### 1. Run the offline acceptance gate

From the repo root:

```bash
npm run amp:acceptance
```

**VERIFIED:** Runs typecheck, build, full test suite, conformance (INV-1..6), and CLI smoke (`ai-memory amp init`, `ai-memory amp doctor`, etc.) without live gbrain.

### 2. Prepare a temp project

```bash
TMP_PROJECT=$(mktemp -d)
TMP_AMP_ROOT=$(mktemp -d)

ai-memory amp init --project-root "$TMP_PROJECT"
```

This protects `.amp/local/` and `.amp/runtime/` in the project `.gitignore`.

### 3. Local dry-run (plan only)

```bash
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
ai-memory amp projection render --source local --dry-run --project-root "$TMP_PROJECT"
```

Expect four planned writes, zero files created, budget summary in output.

### 4. Local apply (explicit offline materialization)

```bash
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
ai-memory amp projection render --source local --apply --project-root "$TMP_PROJECT"
```

**Note:** With only CLI invocations, in-memory knowledge starts empty each process. To see preference text in project projection bodies, either:

- Run capture → consolidate → render in one Node test/process with injected `knowledgeStore`, or
- Seed knowledge in-process before calling `runAmpProjectionRender` (see integration test below)

Runtime queue items **do** persist in the project runtime SQLite DB across CLI invocations, so queued (unconsolidated) signals can appear in project runtime projection without cross-process knowledge sharing.

### 5. Verify git stays clean

```bash
cd "$TMP_PROJECT"
git init
git status --short --untracked-files=all
```

AMP-managed paths (`.amp/local/`, `.amp/runtime/`) must not appear.

---

## How automated tests cover the full local E2E

**VERIFIED:** `src/amp/integration/projection-local-materialization.test.ts`

The integration test:

1. Creates a temp git repo and runs `ai-memory amp init`
2. Captures a project preference into `RuntimeStore`
3. Consolidates to an injected `InMemoryKnowledgeStore` in-process
4. Captures a second runtime note (left queued, not consolidated)
5. Runs local dry-run, then `--source local --apply` with injected knowledge
6. Asserts four files exist under injected `AMP_USER_ROOT` and `.amp/local/`
7. Asserts `git status` does not list AMP-managed artifacts

Tests inject `knowledgeStore` and `AMP_USER_ROOT` because durable offline knowledge is not yet shared across separate CLI processes.

---

## Placeholder dry-run (no stores required)

For pipeline/path/budget parity without reading runtime or knowledge:

```bash
ai-memory amp projection render --dry-run --project-root "$TMP_PROJECT"
```

Uses `PlaceholderProjectionSource` — empty bodies, zero token counts, apply blocked.

---

## Runtime store lifecycle

**VERIFIED:** Local projection CLI rendering opens `RuntimeStore` for `--source local` and closes it in a `finally` block after materialization (success or error). See `src/amp/cli/projection.ts`.

---

## Related reports

- `tools/cursor-sdk-amp-orchestrator/reports/amp-local-projection-materialization.md` — Wave 15 implementation report and claim labels
