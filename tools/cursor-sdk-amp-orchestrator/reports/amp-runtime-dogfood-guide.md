# AMP Runtime Semantics — Operator Dogfood Guide

> **Task:** Prompt 1 — safe local dogfooding in a real workspace (e.g. `ai-product-sense`)
> **Base:** `ralph/amp-runtime-semantics-plan` runtime semantics line
> **Date:** 2026-05-27
> **Scope:** Operator guide only — no production code changes

---

## Verdict

**Safe to dogfood locally with explicit commands only.** Use a linked build from `ai-memory`, a throwaway branch in the target repo, and isolated env vars (`AMP_USER_ROOT`, `AMP_KNOWLEDGE_BACKEND=in-memory`). This exercises typed runtime storage (`amp runtime correct` / `inspect`) and offline local projection without live gbrain, automatic capture, or consolidation.

---

## What this path exercises

| Step | Command | Storage / side effects |
|------|---------|------------------------|
| Init | `amp init` | Project `.amp/config.yaml`, `.amp/runtime/` dir, `.amp/local/`; SQLite file appears on first typed write |
| Health | `amp doctor`, `amp runtime status` | Read-only checks |
| Explicit correction | `amp runtime correct --id … --note …` | Typed `episodic-frame` row in project runtime DB |
| Inspect | `amp runtime inspect [--json]` | Read-only typed entity report |
| Projection plan | `amp projection render --source local --dry-run` | No disk writes |
| Projection apply | `amp projection render --source local --apply` | Writes four markdown files (project + global under `AMP_USER_ROOT`) |

**Not exercised (intentionally):** live gbrain reads/writes, `amp capture`, `amp consolidate`, agent setup apply, Hermes/Cursor/Claude propagation.

---

## Prerequisites

1. **Local build linked** — from `ai-memory`:

```bash
cd /path/to/ai-memory
npm run build
npm link
which amp   # should resolve to the linked package bin
amp --version
```

2. **Target workspace** — any real repo with git; example uses `ai-product-sense`.

3. **Session env** — set once per shell in the target workspace:

```bash
export AMP_USER_ROOT="$PWD/.amp/dogfood-user"
export AMP_KNOWLEDGE_BACKEND=in-memory

# Optional but recommended when AMP_USER_ROOT lives inside the repo:
echo ".amp/dogfood-user/" >> .gitignore
```

| Variable | Purpose |
|----------|---------|
| `AMP_USER_ROOT` | Keeps **global** projection/runtime markdown under the project (`.amp/dogfood-user/…`) instead of `~/.amp` |
| `AMP_KNOWLEDGE_BACKEND=in-memory` | **Required** for `--source local` projection; default backend is `gbrain` and will fail closed with `LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE` |

Project-local runtime SQLite lives at `.amp/runtime/runtime.db` after `amp init` (from project config). No need to override `AMP_RUNTIME_PATH` unless you want a custom DB path.

---

## Safe operator flow

### 1. Enter target workspace on a throwaway branch

```bash
cd /path/to/ai-product-sense   # or your real workspace
git status
git switch -c amp-runtime-dogfood

export AMP_USER_ROOT="$PWD/.amp/dogfood-user"
export AMP_KNOWLEDGE_BACKEND=in-memory
```

### 2. Initialize and verify

```bash
amp init
amp doctor
amp runtime status
```

- If `amp init` reports config already exists, that is fine. **Do not** use `--force` unless you intend to replace project AMP config.
- `amp runtime status` should list supported entity schemas and note that local typed storage is wired for inspect/seed/correct.

### 3. Add one explicit correction

```bash
amp runtime correct \
  --id dogfood-start \
  --note "Dogfood note: starting AMP runtime semantics test in ai-product-sense."
```

**Semantics:** Persists an `episodic-frame` with `event_type: "correction"` — episodic operator feedback, **not durable knowledge**. See `amp-runtime-explicit-correction-contract.md`.

**Idempotency:** Default record id is `explicit-correction:dogfood-start`. A second `correct` with the **same `--id`** fails closed with `duplicate_id` even if `--note` changes (by design). Use a **new `--id`** for additional corrections via CLI.

**Experimental surfaces:** `amp runtime inspect` and `amp runtime seed` are CLI-labeled experimental; `correct` is the primary dogfood write path. The overall runtime CLI remains pre-release.

### 4. Inspect typed storage

```bash
amp runtime inspect
amp runtime inspect --json
amp runtime inspect --entity episodic-frame
```

Expect one valid `episodic-frame` row with your note in the payload.

### 5. Render projection — dry-run first

```bash
amp projection render --source local --dry-run
```

Review the planned writes (four paths: project `.amp/local/projection.md`, `.amp/local/runtime.md`, plus global files under `$AMP_USER_ROOT`).

### 6. Apply only if dry-run looks sane

```bash
amp projection render --source local --apply
```

Inspect outputs:

```bash
cat .amp/local/runtime.md
cat .amp/local/projection.md
cat "$AMP_USER_ROOT/runtime/global.md"
cat "$AMP_USER_ROOT/projection/global.md"
```

The correction should appear under an episodic heading (e.g. **Episodic correction (not durable truth)**), not as consolidated preference truth.

---

## Footguns

| Mistake | Effect |
|---------|--------|
| `amp projection render --source local` without `--dry-run` or `--apply` | **Defaults to apply** — writes four files immediately when env is set |
| Forgetting env vars in a subshell | Local projection fails or global files land under `~/.amp` |
| `amp consolidate` with in-memory backend | Still promotes queue → knowledge — not the explicit-correction path |
| `amp runtime seed` | Writes arbitrary typed entities into the same DB you inspect |

---

## Rollback

Project `.amp/local/` and `.amp/runtime/` are gitignored by `amp init` (Invariant 6). **`.amp/dogfood-user/` is not** — add it to `.gitignore` or use a temp dir outside the repo for `AMP_USER_ROOT`.

To discard:

```bash
# leave the dogfood branch
git switch -

# optional: remove dogfood AMP artifacts (only if you have no prior AMP state you care about)
rm -rf .amp/dogfood-user .amp/local .amp/runtime .amp/config.yaml
```

To unlink the local CLI build:

```bash
cd /path/to/ai-memory
npm unlink -g @radix-ai/ai-memory   # or reinstall the published package
```

---

## Do not test yet

| Avoid | Reason |
|-------|--------|
| Live gbrain (`--source gbrain`, default knowledge backend) | Reads/writes real brain; requires preflight and opt-in |
| `amp projection render --source gbrain` (even `--dry-run`) | Spawns gbrain preflight / readonly transport probes |
| `amp consolidate` / `amp retrieve` (any backend) | Promotion and durable knowledge paths; not explicit correction |
| `amp capture` | Queue capture automation — not the explicit correction contract |
| `amp runtime seed` | Experimental typed-entity writes into the same runtime DB |
| `amp agent setup --apply` | Mutates Cursor/Claude/Codex harness files |
| `amp propagate` | Compiles registry procedures to verified harness roots |
| `amp projection render --source local` without explicit `--dry-run` or `--apply` | Defaults to apply |
| Publishing this branch to npm | Runtime CLI is **experimental**; wait for release-readiness audit (Prompt 3) |
| `--force` on `amp init` in a repo with existing AMP config | Overwrites project config |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Project AMP config not found` | Skipped `amp init` | Run `amp init` in project root |
| Local projection knowledge unavailable | Missing `AMP_KNOWLEDGE_BACKEND=in-memory` | Export env var in shell |
| `duplicate_id` on second `runtime correct` | Same `--id` (even with changed `--note`) | New `--id`; use `amp runtime correct --json` for `reason` codes |
| `invalid_note` | Empty or whitespace-only `--note` | Provide non-empty note text |
| Global files under `~/.amp` | Missing `AMP_USER_ROOT` | Export before projection apply |
| Linked `amp` not picked up | Stale global install | Re-run `npm link` from `ai-memory` after build |

---

## Related reports

- Explicit correction contract: `tools/cursor-sdk-amp-orchestrator/reports/amp-runtime-explicit-correction-contract.md`
- Local projection materialization: `tools/cursor-sdk-amp-orchestrator/reports/amp-local-projection-materialization.md`
- Real gbrain safety: `tools/cursor-sdk-amp-orchestrator/reports/amp-real-gbrain-safety.md`

---

## Validation (repo gate)

Run from `ai-memory` after adding this report:

```bash
npm run typecheck
npm run amp:acceptance
git diff --check
```

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** (2026-05-27) |
| `npm run amp:acceptance` | **PASS** (2026-05-27) |
| `git diff --check` | **PASS** (no conflict markers or trailing whitespace) |

---

## Thermo-nuclear code quality review

**Reviewer:** thermo-nuclear-code-quality-review subagent  
**Scope:** Guide accuracy vs. CLI sources (`runtime.ts`, `runtime-inspect.ts`, `projection.ts`, `projection-source.ts`, `knowledge-backend.ts`, `init.ts`, `index.ts`)  
**Post-fix verdict:** **Approve with notes** — guide updated to address blockers from initial review

### Initial blockers (fixed in this revision)

| Finding | Resolution |
|---------|------------|
| False Invariant 6 claim for `AMP_USER_ROOT` | Rollback section now states `.amp/dogfood-user/` is **not** gitignored; prerequisites recommend adding it to `.gitignore` |
| Documented `--record-id` CLI flag (not exposed) | Removed; idempotency section documents one correction per `--id` via CLI only |
| Missing projection default-apply footgun | Added **Footguns** section |
| Incomplete "do not test yet" list | Added `seed`, gbrain dry-run, consolidate with in-memory, implicit apply mode |
| Imprecise `duplicate_id` semantics | Clarified same `--id` fails even when `--note` changes |

### Remaining notes (non-blocking)

- **Experimental labels:** `inspect`/`seed` are CLI-labeled experimental; guide now calls this out.
- **Init timing:** Table notes SQLite appears on first typed write, not necessarily at init.
- **Bootstrap error text:** Some CLI paths say ``Run `ai-memory amp init` first``; linked `amp init` is equivalent.

### Verified CLI alignment

| Guide claim | Confirmed |
|-------------|-----------|
| `AMP_KNOWLEDGE_BACKEND=in-memory` required for `--source local` | `resolveProjectionKnowledgeStore()` |
| Default knowledge backend is `gbrain` | `resolveKnowledgeBackend()` |
| Four projection paths | `projection/paths.ts` |
| `duplicate_id` on repeated `--id` | `defaultExplicitCorrectionRecordId` + storage writer |
| Episodic projection heading | `EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING` |
| Placeholder source blocks apply | `PlaceholderProjectionSource.supportsApply === false` |

### Approval bar

| Criterion | Status |
|-----------|--------|
| No false safety invariants | **Pass** (after fix) |
| Documented commands match CLI contracts | **Pass** |
| Footguns documented | **Pass** |
| Happy-path flow accurate | **Pass** |
| Operator-readable structure | **Pass** |

**Summary:** Core flow (`init` → env → `correct` → `inspect` → `projection render --source local --dry-run` → `--apply`) matches implementation. Safe to use for local dogfooding when operators follow the env isolation and footgun callouts.
