# AMP Runtime Semantics — Operator Dogfood Guide

> **Task:** LOCAL-KNOW-04 — durable local knowledge dogfooding in a real workspace (e.g. `ai-product-sense`)
> **Base:** `ralph/amp-runtime-semantics-plan` runtime semantics line
> **Date:** 2026-05-27
> **Scope:** Operator docs and CLI copy for persistent local knowledge (companion message/status updates in `src/amp/`)

---

## Verdict

**Safe to dogfood locally with explicit commands only.** Use a linked build from `ai-memory`, a throwaway branch in the target repo, and isolated env vars (`AMP_USER_ROOT`). This exercises typed runtime storage (`amp runtime correct` / `inspect`), durable local knowledge (`amp runtime graduation apply`), and offline local projection (`amp projection render --source local`) without live gbrain, automatic capture, or consolidation.

---

## What this path exercises

| Step | Command | Storage / side effects |
|------|---------|------------------------|
| Init | `amp init` | Project `.amp/config.yaml`, `.amp/runtime/` dir, `.amp/local/`; SQLite appears on first typed write |
| Health | `amp doctor`, `amp runtime status` | Read-only checks |
| Explicit correction | `amp runtime correct --id … --note …` | Typed `episodic-frame` row in project runtime DB (episodic, not durable knowledge) |
| Seed candidate (optional) | `amp runtime seed --file …` | Typed `runtime-preference-candidate` row for graduation dogfood |
| Graduation review | `amp runtime graduation plan` | Read-only graduation decisions |
| Graduation apply | `amp runtime graduation apply --id …` | Writes one durable semantic frame to `.amp/runtime/knowledge.db` |
| Inspect | `amp runtime inspect [--json]` | Read-only typed entity report |
| Projection plan | `amp projection render --source local --dry-run` | Plans four paths; may create empty `knowledge.db` on first open |
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

# Optional but recommended when AMP_USER_ROOT lives inside the repo:
echo ".amp/dogfood-user/" >> .gitignore
```

| Variable | Purpose |
|----------|---------|
| `AMP_USER_ROOT` | Keeps **global** projection/runtime markdown under the project (`.amp/dogfood-user/…`) instead of `~/.amp` |

**Local knowledge storage:** Durable frames live in `.amp/runtime/knowledge.db` beside `runtime.db`. `--source local` reads this file by default after `amp init`. You do **not** need `AMP_KNOWLEDGE_BACKEND=in-memory` for local projection. Default `amp retrieve` also reads this persistent store; setting `AMP_KNOWLEDGE_BACKEND=gbrain` in the shell overrides that default and routes retrieve through live gbrain instead.

Project-local runtime SQLite lives at `.amp/runtime/runtime.db` after `amp init` (from project config). No need to override `AMP_RUNTIME_PATH` unless you want a custom DB path.

---

## Safe operator flow

### 1. Enter target workspace on a throwaway branch

```bash
cd /path/to/ai-product-sense   # or your real workspace
git status
git switch -c amp-runtime-dogfood

export AMP_USER_ROOT="$PWD/.amp/dogfood-user"
```

### 2. Initialize and verify

```bash
amp init
amp doctor
amp runtime status
```

- If `amp init` reports config already exists, that is fine. **Do not** use `--force` unless you intend to replace project AMP config.
- `amp runtime status` should list supported entity schemas and note that local typed storage is wired for inspect/seed/correct.

### 3. Add one explicit correction (episodic)

```bash
amp runtime correct \
  --id dogfood-start \
  --note "Dogfood note: starting AMP runtime semantics test in ai-product-sense."
```

**Semantics:** Persists an `episodic-frame` with `event_type: "correction"` — episodic operator feedback, **not durable knowledge**. See `amp-runtime-explicit-correction-contract.md`.

**Idempotency:** Default record id is `explicit-correction:dogfood-start`. A second `correct` with the **same `--id`** fails closed with `duplicate_id` even if `--note` changes (by design). Use a **new `--id`** for additional corrections via CLI.

### 4. (Optional) Seed and graduate a preference candidate

For durable knowledge that appears in projection bodies, seed a confirmed preference candidate and apply graduation:

```bash
cat > seed.json <<'EOF'
{
  "id": "pref-dogfood",
  "kind": "runtime-preference-candidate",
  "scope": "user",
  "payload": {
    "id": "pref-dogfood",
    "statement": "Keep responses short today",
    "mode": "time_bounded",
    "scope": "user",
    "context": {},
    "status": "active",
    "expires_at": "2026-05-27T12:00:00.000Z",
    "first_observed_at": "2026-05-27T12:00:00.000Z",
    "last_observed_at": "2026-05-27T12:00:00.000Z",
    "source_signal_ids": ["signal-dogfood"],
    "confidence": "medium",
    "promotion_evidence": {
      "repetition_count": 0,
      "independent_sessions": 0,
      "explicit_confirmation_signal_id": "confirm-dogfood"
    }
  }
}
EOF

amp runtime seed --file seed.json
amp runtime graduation plan
amp runtime graduation apply --id pref-dogfood
```

**Semantics:** Graduation apply writes one semantic frame to `.amp/runtime/knowledge.db` without mutating the runtime semantic entity row. Re-running apply with the same id fails closed on duplicate durable frame ids.

**Experimental surfaces:** `amp runtime inspect`, `seed`, and `graduation plan`/`apply` are CLI-labeled experimental; `correct` is the primary episodic dogfood write path. The overall runtime CLI remains pre-release.

### 5. Inspect typed storage

```bash
amp runtime inspect
amp runtime inspect --json
amp runtime inspect --entity episodic-frame
```

Expect correction rows under `episodic-frame` and, if seeded, preference candidates under `runtime-preference-candidate`.

### 6. Render projection — dry-run first

```bash
amp projection render --source local --dry-run
```

Review the planned writes (four paths: project `.amp/local/projection.md`, `.amp/local/runtime.md`, plus global files under `$AMP_USER_ROOT`).

**Note:** First local projection open may create an empty `.amp/runtime/knowledge.db` even on dry-run. That is expected when no graduation apply has run yet.

### 7. Apply only if dry-run looks sane

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

Corrections appear under an episodic heading (e.g. **Episodic correction (not durable truth)**), not as consolidated preference truth. Graduated preferences appear in projection bodies when present in `knowledge.db`.

---

## Footguns

| Mistake | Effect |
|---------|--------|
| `amp projection render --source local` without `--dry-run` or `--apply` | **Defaults to apply** — writes four files immediately |
| Forgetting `AMP_USER_ROOT` in a subshell | Global files land under `~/.amp` |
| Expecting `runtime correct` alone to populate durable projection preferences | Corrections are episodic only; use graduation apply for durable knowledge |
| `amp consolidate` | Promotion path — not the explicit correction or graduation apply contract |
| `amp runtime seed` | Writes arbitrary typed entities into the same DB you inspect |
| Assuming dry-run never touches disk | Local projection may create empty `knowledge.db` on first open |

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
| `amp consolidate` / `amp retrieve` (any backend) | Promotion and durable knowledge paths; not explicit correction / graduation apply |
| `amp capture` | Queue capture automation — not the explicit correction contract |
| `amp agent setup --apply` | Mutates Cursor/Claude/Codex harness files |
| `amp propagate` | Compiles registry procedures to verified harness roots |
| `amp projection render --source local` without explicit `--dry-run` or `--apply` | Defaults to apply |
| Publishing this branch to npm | Runtime CLI is **experimental**; wait for release-readiness audit |
| `--force` on `amp init` in a repo with existing AMP config | Overwrites project config |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Project AMP config not found` | Skipped `amp init` | Run `amp init` in project root |
| Local projection knowledge unavailable | Runtime storage not initialized | Run `amp init`; ensure `.amp/runtime/runtime.db` exists |
| Empty projection preference bodies | No frames in `knowledge.db` yet | Run `amp runtime graduation apply --id …` after seeding a confirmed candidate |
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
