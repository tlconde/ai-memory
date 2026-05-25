# AMP gbrain Projection Live Verification (AMP-GBRAIN-PROJ-02-REPAIR)

> **Date:** 2026-05-25  
> **Base:** `ralph/amp-gbrain-proj-02-live-test` (`e8a5b38`)
> **Branch:** `ralph/amp-gbrain-proj-02-repair`
> **Scope:** Opt-in read-only live verification for `amp projection render --source gbrain`

---

## Architecture (simplified)

```
CLI (--source gbrain)
  → projection source factory (collectGbrainPreflightChecks when strict)
    → ReadonlyGbrainMcpTransport(inner: FakeGbrainMcpTransport | GbrainServeStdioTransport)
      → GbrainKnowledgeAdapter
        → GbrainProjectionSource.listFrames()
          → buildProjectionDocuments()
            → materialize pipeline (ProjectionSourceLoadError → { ok: false })
```

Projection source selection uses `--source gbrain` only. `AMP_KNOWLEDGE_BACKEND` controls consolidate/retrieve defaults, not projection source selection. No separate `projection-gbrain-preflight.ts`, `gbrain-readonly-knowledge.ts`, or `section-mapping.ts` modules.

---

## Verdict

**Live gbrain projection render is opt-in and outside the offline acceptance gate.**

| Path | Gate | gbrain mutation | Label |
|------|------|-----------------|-------|
| Fake-transport gbrain projection (unit/CLI tests) | default CI | **No** | **VERIFIED** |
| Readonly transport rejects mutating MCP tools | default CI | **No** | **VERIFIED** |
| Read-only live dry-run | `AMP_LIVE_GBRAIN=1` | **No** | **PROVISIONAL** until operator run passes |
| Offline acceptance | default CI | **No** | **VERIFIED** — live test skipped by default |

Live delete/cleanup is **not** part of the projection source path.

---

## Test artifact

| File | Purpose |
|------|---------|
| `src/amp/integration/gbrain-projection-live.test.ts` | Opt-in read-only live dry-run only |
| `src/amp/adapters/ssa/gbrain/readonly-transport.ts` | Transport-boundary mutating tool rejection |
| `src/amp/projection/build-documents.test.ts` | Canonical routing/scope/revision/token tests |

**Skip message (default CI):** `# set AMP_LIVE_GBRAIN=1 to run against gbrain serve (read-only projection)`

---

## Operator procedure

Run from the ai-memory repo root after offline gate is green.

### 1. Offline preflight (required)

```bash
npm run amp:acceptance
npm run typecheck
npm test -- src/amp/projection/
npm test -- src/amp/cli/projection.test.ts
npm test -- src/amp/adapters/ssa/gbrain/
npm test -- src/amp/integration/gbrain-projection-live.test.ts
```

Confirm live projection test is **skipped** in default output.

### 2. Prepare temp project (avoid real ~/.amp)

```bash
TMP_BASE=$(mktemp -d)
TMP_PROJECT="$TMP_BASE/project"
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"

ai-memory amp init --project-root "$TMP_PROJECT"
cd "$TMP_PROJECT" && git init
```

### 3. Opt-in read-only projection test (no gbrain writes, no cleanup)

```bash
cd /path/to/ai-memory
AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-projection-live.test.ts
```

**Expected:** read-only dry-run passes against live `gbrain serve`. Empty brain yields zero-byte projection bodies gracefully.

### 4. Manual CLI parity (operator spot-check)

```bash
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"

ai-memory amp projection render --source gbrain --dry-run --project-root "$TMP_PROJECT"
```

Does **not** require `AMP_KNOWLEDGE_BACKEND=gbrain`.

---

## What mutates what

| Component | Read-only live test | Manual `--apply` |
|-----------|---------------------|------------------|
| gbrain database (MCP) | **No** | **No** |
| `<project>/.amp/local/*.md` | **No** (dry-run) | **Yes** |
| `$AMP_USER_ROOT/projection\|runtime/*.md` | **No** (dry-run) | **Yes** |
| git-tracked files | **No** | **No** (Invariant 6) |

---

## Claim labels

| Claim | Label | Evidence |
|-------|-------|----------|
| Fake-transport gbrain projection | **VERIFIED** | `gbrain-source.test.ts`, `projection.test.ts` |
| Readonly wrapper rejects mutating MCP tools | **VERIFIED** | `readonly-transport.test.ts` |
| Live read-only dry-run | **PROVISIONAL** | Opt-in test; operator run required |
| Live test skipped by default | **VERIFIED** | `isLiveGbrainTestEnabled()` gate |
| Projection source independent of `AMP_KNOWLEDGE_BACKEND=gbrain` | **VERIFIED** | Factory uses `--source gbrain`; live test omits env |
| Live delete/cleanup in projection source | **VERIFIED absent** | Sentinel suite removed |
| Acceptance gate excludes live gbrain projection | **VERIFIED** | No registry change; test opt-in only |

---

## Verification run (repair)

| Command | Result |
|---------|--------|
| `npm run typecheck` | (see commit) |
| `npm test -- src/amp/projection/` | (see commit) |
| `npm test -- src/amp/cli/projection.test.ts` | (see commit) |
| `npm test -- src/amp/adapters/ssa/gbrain/` | (see commit) |
| `npm test -- src/amp/integration/gbrain-projection-live.test.ts` | skipped ( `AMP_LIVE_GBRAIN=1` not run ) |
| `npm run amp:acceptance` | (see commit) |
| `git diff --check` | (see commit) |

**`AMP_LIVE_GBRAIN=1`:** not run in this repair session.

---

## Related docs

- `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-live.md` — adapter MCP round trip
- `docs/guides/AMP_LOCAL_TESTING.md` — operator workflow
