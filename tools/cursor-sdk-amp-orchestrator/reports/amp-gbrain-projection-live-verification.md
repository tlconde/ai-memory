# AMP gbrain Projection Live Verification (AMP-GBRAIN-PROJ-02)

> **Date:** 2026-05-25  
> **Base:** `ralph/amp-gbrain-proj-01-source`  
> **Branch:** `ralph/amp-gbrain-proj-02-live-test`  
> **Scope:** Opt-in live verification for `amp projection render --source gbrain` (read-only by default)

---

## Verdict

**Live gbrain projection render is opt-in and outside the offline acceptance gate.**

| Path | Gate | gbrain mutation | Label |
|------|------|-----------------|-------|
| Read-only dry-run | `AMP_LIVE_GBRAIN=1` | **No** | **PROVISIONAL** until operator run passes |
| Sentinel frame setup | `AMP_LIVE_GBRAIN=1` + `AMP_CONFIRM_LIVE_GBRAIN_WRITE=1` | **Yes** (AMP-owned slug only) | **PROVISIONAL** |
| Offline acceptance | default CI | **No** | **VERIFIED** — test skipped by default |

---

## Test artifact

| File | Purpose |
|------|---------|
| `src/amp/integration/gbrain-projection-live.test.ts` | Opt-in live projection verification |

**Skip messages (default CI):**

- `# set AMP_LIVE_GBRAIN=1 to run against gbrain serve (read-only projection)`
- `# set AMP_CONFIRM_LIVE_GBRAIN_WRITE=1 to write AMP-owned sentinel frame`

**Sentinel naming:** `live-proj-{timestamp}-{random}` → slug `amp/frames/h.{hex}` (AMP-owned prefix only).

**Cleanup:** best-effort `delete_page` in `finally`; **PROVISIONAL** soft-delete semantics (~72h recoverable via `restore_page`). Failure uses `formatResidualPageWarning()` from `src/amp/gbrain/live-policy.ts`.

---

## Operator procedure

Run from the ai-memory repo root after offline gate is green.

### 1. Offline preflight (required)

```bash
npm run amp:acceptance
npm run typecheck
npm test -- src/amp/integration/ src/amp/projection/ src/amp/adapters/ssa/gbrain/
```

Confirm live projection test is **skipped** in default output.

### 2. Backup real gbrain database (before first live projection)

**PROVISIONAL** — filesystem copy; no AMP auto-backup:

```bash
gbrain config show   # note database_path
# stop gbrain serve / MCP clients using the DB
cp -a "$DATABASE_PATH" "$BACKUP_DIR/brain.pglite.backup.$(date +%Y%m%d)"
```

**Label:** gbrain first-party backup command — **UNKNOWN**.

### 3. gbrain preflight and manual migration (if doctor warns)

```bash
ai-memory amp gbrain-preflight --knowledge gbrain
# if WARN [gbrain-migrate]:
gbrain init --migrate-only   # manual — AMP will NOT run this
ai-memory amp gbrain-preflight --knowledge gbrain
```

**Label:** migrate-only fixes — **PROVISIONAL**. AMP never auto-runs migration.

### 4. Prepare temp project (avoid real ~/.amp)

```bash
TMP_BASE=$(mktemp -d)
TMP_PROJECT="$TMP_BASE/project"
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"
export AMP_KNOWLEDGE_BACKEND=gbrain

ai-memory amp init --project-root "$TMP_PROJECT"
cd "$TMP_PROJECT" && git init
```

### 5. Opt-in read-only projection test (no gbrain writes)

```bash
cd /path/to/ai-memory
AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-projection-live.test.ts
```

**Expected:** read-only dry-run case passes; sentinel case skipped unless write confirmation is set.

### 6. Optional sentinel verification (explicit gbrain write)

Only when operator accepts a transient AMP-owned page in the real brain:

```bash
AMP_LIVE_GBRAIN=1 AMP_CONFIRM_LIVE_GBRAIN_WRITE=1 \
  npm test -- src/amp/integration/gbrain-projection-live.test.ts
```

**Expected:** sentinel frame written under `amp/frames/h.*`, included in project projection dry-run plan, best-effort delete in `finally`.

### 7. Manual CLI parity (operator spot-check)

```bash
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"
export AMP_KNOWLEDGE_BACKEND=gbrain

ai-memory amp projection render --source gbrain --dry-run --project-root "$TMP_PROJECT"
```

Expect `PROVISIONAL: live gbrain read` on stderr when live transport connects (**PROVISIONAL** — depends on CLI wiring).

---

## What mutates what

| Component | Read-only test | Sentinel test | Manual `--apply` |
|-----------|----------------|---------------|------------------|
| gbrain database (MCP) | **No** | **Yes** (one sentinel page) | **No** |
| `<project>/.amp/local/*.md` | **No** (dry-run) | **No** (dry-run) | **Yes** |
| `$AMP_USER_ROOT/projection\|runtime/*.md` | **No** (dry-run) | **No** (dry-run) | **Yes** |
| git-tracked files | **No** | **No** | **No** (Invariant 6) |

---

## Claim labels

| Claim | Label | Evidence |
|-------|-------|----------|
| Live projection test skipped by default | **VERIFIED** | `isLiveGbrainTestEnabled()` gate in test file |
| Read-only path performs no gbrain writes during render | **PROVISIONAL** | Design + dry-run test; operator run required |
| Sentinel writes require `AMP_CONFIRM_LIVE_GBRAIN_WRITE=1` | **VERIFIED** | Second describe block skip + `assertLiveGbrainWriteConfirmed()` |
| AMP-owned sentinel ids only (`live-proj-*`) | **VERIFIED** | Test assertions before write |
| delete_page cleanup semantics | **PROVISIONAL** | Same as `amp-gbrain-live.md` |
| Acceptance gate excludes live gbrain projection | **VERIFIED** | No registry change; test opt-in only |
| Automatic `gbrain init --migrate-only` | **VERIFIED absent** | Docs + preflight recommend-only |

---

## Residual risks

1. **Empty projection bodies:** read-only test passes with zero durable frames; operator may misread empty project projection as failure.
2. **project_ref mismatch:** sentinel uses init-derived `project_ref`; frames under other refs are skipped by section routing.
3. **Doctor vs MCP divergence:** migrate warnings may appear while MCP read/render succeeds (**PROVISIONAL**).
4. **Residual sentinel pages:** failed cleanup leaves recoverable soft-deleted pages under `amp/frames/h.*`.
5. **Cross-process knowledge:** runtime queue is local SQLite; gbrain source reads durable knowledge only from gbrain.

---

## Related docs

- `docs/guides/AMP_LOCAL_TESTING.md` — operator workflow (live gbrain projection section)
- `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-projection-source-plan.md` — design plan
- `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-live.md` — adapter MCP round trip
