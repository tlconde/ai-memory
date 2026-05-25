# AMP Local Testing — Operator Guide

> **Audience:** Operators and contributors running AMP offline on a laptop or in CI
> **Scope:** Local projection materialization (Wave 15), local agent-access setup (Wave 16), Invariant 6 safety, and acceptance gates
> **Companion:** `docs/specs/AMP_CONSOLIDATED_SPEC.md` §4.2.1, §12.6

---

## What this guide covers

AMP v1 ships an **offline local projection path** that materializes four markdown projection files from:

- **Runtime store** — SQLite queue/KV at `<project>/.amp/runtime/` (working memory)
- **Knowledge store** — in-memory backend for tests; live gbrain for consolidate/retrieve (not for projection source in Wave 15)

This guide explains how to dry-run and apply projections safely without touching real `~/.amp` or git-tracking AMP-managed artifacts.

**CLI:** Examples use `amp …`. The same commands work as `ai-memory amp …` when invoked via the `ai-memory` binary.

---

## Safety defaults

| Rule | Why |
|------|-----|
| Set `AMP_USER_ROOT` to a temp directory | Global projection files resolve under `AMP_USER_ROOT`, not necessarily `~/.amp` |
| Run `amp init` before projection commands | Creates `.amp/local/`, `.amp/runtime/`, and gitignore entries (Invariant 6) |
| Never rely on real `~/.amp` in tests | Integration tests inject `AMP_USER_ROOT` and reject real homedir resolution |
| Project-local outputs live under `.amp/local/` | Gitignored by `amp init`; must not appear in `git status` |

**VERIFIED:** Invariant 6 tests and `src/amp/integration/projection-local-materialization.test.ts` enforce git cleanliness for AMP-managed paths.

---

## Live verification vs offline acceptance

| Topic | Label | Notes |
|-------|-------|-------|
| Offline acceptance gate (`npm run amp:acceptance`) | **VERIFIED** | Deterministic; no live harness sessions, live gbrain, or network |
| Claude Code project context via AMP setup (`CLAUDE.md` marker + `@` imports) | **VERIFIED** | Live session load confirmed; see `amp-local-agent-live-verification.md` |
| Cursor project context via flattened `.mdc` | **VERIFIED** | Live session load confirmed; temp project must be workspace root |
| Codex project context via `AGENTS.md` marker block | **VERIFIED** | Live session load confirmed; see `amp-codex-agent-setup-live.md` |
| Codex `@import` / `@path` in `AGENTS.md` | **UNKNOWN** | Not used by AMP; not tested |
| Cursor recursive `@` imports in projection paths | **UNKNOWN** | Not used; Wave 16 inlines into `.mdc` instead |
| Live gbrain / Hermes | **PROVISIONAL** (opt-in) | Separate from acceptance gate; see `amp-gbrain-live.md`, `amp-hermes-live.md` |

---

## Projection materialization modes

| Mode | Command shape | Writes disk? | Source | Status |
|------|---------------|--------------|--------|--------|
| Placeholder dry-run | `amp projection render --dry-run` | No | Fixture documents only | **VERIFIED** |
| Placeholder apply | `amp projection render` (no flags) | No — blocked | Placeholder refuses apply | **VERIFIED** |
| Local dry-run | `--source local --dry-run` + `AMP_KNOWLEDGE_BACKEND=in-memory` | No | Runtime DB + in-memory knowledge | **VERIFIED** |
| Local apply | `--source local --apply` + `AMP_KNOWLEDGE_BACKEND=in-memory` | Yes (four files) | Runtime DB + in-memory knowledge | **VERIFIED** |
| Gbrain dry-run | `--source gbrain --dry-run` + `AMP_KNOWLEDGE_BACKEND=gbrain` | No | Live gbrain durable frames + local runtime DB | **PROVISIONAL** (opt-in live test) |
| Gbrain apply | `--source gbrain --apply` + `AMP_KNOWLEDGE_BACKEND=gbrain` | Yes (four files); **no gbrain writes** | Live gbrain durable frames + local runtime DB | **PROVISIONAL** (operator manual) |

### Explicit apply is required

Local apply **always** requires both flags:

```bash
--source local --apply
```

Default behavior without `--dry-run` attempts apply mode. Placeholder source blocks apply with `DB-backed projection materialization is not wired yet.` Local source without an offline knowledge backend fails with a message suggesting `--source placeholder --dry-run`.

**VERIFIED:** `src/amp/cli/projection.test.ts`

---

## What is NOT implemented (Wave 15–16)

| Capability | Status |
|------------|--------|
| Live gbrain projection source (`--source gbrain`) | **Implemented** — read-only gbrain MCP during render; opt-in live test |
| Live gbrain projection in acceptance gate | **Not in gate** — skipped unless `AMP_LIVE_GBRAIN=1` |
| Live gbrain / Hermes MCP round trip in acceptance gate | **Not in gate** — opt-in live checks only; gate stays offline |
| Cursor recursive `@` imports for projection files | **UNKNOWN / not used** — Wave 16 uses flattened `.mdc` under `.cursor/rules/from-amp/` instead |
| Codex `@import` in `AGENTS.md` | **UNKNOWN / not used** — AMP inlines projection bodies in marker block |
| Claude global `~/.claude/CLAUDE.md` wiring | **Not implemented** — project `CLAUDE.md` marker block only |
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

Examples below assume you run from the repo root after `npm run build` (or use `npx amp` / `node dist/cli/index.js`).

### 1. Run the offline acceptance gate

From the repo root:

```bash
npm run amp:acceptance
```

**VERIFIED:** Runs typecheck, build, full test suite, conformance (INV-1..6), and CLI smoke (`amp init`, `amp doctor`, etc.) without live gbrain or live harness sessions.

### 2. Prepare a temp project

```bash
TMP_PROJECT=$(mktemp -d)
TMP_AMP_ROOT=$(mktemp -d)

amp init --project-root "$TMP_PROJECT"
```

This protects `.amp/local/` and `.amp/runtime/` in the project `.gitignore`.

### 3. Local dry-run (plan only)

```bash
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
amp projection render --source local --dry-run --project-root "$TMP_PROJECT"
```

Expect four planned writes, zero files created, budget summary in output.

### 4. Local apply (explicit offline materialization)

```bash
AMP_USER_ROOT="$TMP_AMP_ROOT" \
AMP_KNOWLEDGE_BACKEND=in-memory \
amp projection render --source local --apply --project-root "$TMP_PROJECT"
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

1. Creates a temp git repo and runs `amp init`
2. Captures a project preference into `RuntimeStore`
3. Consolidates to an injected `InMemoryKnowledgeStore` in-process
4. Captures a second runtime note (left queued, not consolidated)
5. Runs local dry-run, then `--source local --apply` with injected knowledge
6. Asserts four files exist under injected `AMP_USER_ROOT` and `.amp/local/`
7. Asserts `git status` does not list AMP-managed artifacts

Tests inject `knowledgeStore` and `AMP_USER_ROOT` because durable offline knowledge is not yet shared across separate CLI processes.

---

## Local agent-access setup (Wave 16)

After project projection files exist under `.amp/local/`, wire them into local agent surfaces with explicit dry-run/apply:

### Claude Code (project `CLAUDE.md`)

**VERIFIED:** `amp agent setup --target claude-code` inserts or updates an AMP marker block in `<project>/CLAUDE.md` with:

```markdown
@.amp/local/projection.md
@.amp/local/runtime.md
```

- Default is dry-run (no writes). Pass `--apply` to mutate disk.
- User-authored content outside the marker block is preserved.
- Claude Code `@path` import semantics are **VERIFIED** (Anthropic docs + live session load via AMP setup).

### Cursor (flattened from-amp rule)

**VERIFIED:** `amp agent setup --target cursor --apply` writes:

`<project>/.cursor/rules/from-amp/amp-projection.mdc`

The file inlines projection and runtime markdown — **no recursive `@` imports**. Cursor recursive import behavior remains **UNKNOWN / not used**. Live session load of the flattened rule is **VERIFIED** when the temp project is opened as the workspace root.

### Codex (project `AGENTS.md` marker block)

**VERIFIED:** `amp agent setup --target codex --apply` upserts an AMP marker block in `<project>/AGENTS.md` with inlined projection and runtime bodies (same flattening strategy as Cursor). Codex `@import` behavior is **UNKNOWN / not used**. Live session load is **VERIFIED** — see `amp-codex-agent-setup-live.md`.

### Safe command examples

```bash
# Preview Claude wiring
amp agent setup --target claude-code --dry-run --project-root "$TMP_PROJECT"

# Apply Claude wiring (requires .amp/local/ directory)
amp agent setup --target claude-code --apply --project-root "$TMP_PROJECT"

# Preview Cursor flattened rule
amp agent setup --target cursor --dry-run --project-root "$TMP_PROJECT"

# Apply Cursor flattened rule (requires projection.md and runtime.md)
amp agent setup --target cursor --apply --project-root "$TMP_PROJECT"

# Preview Codex AGENTS.md marker block
amp agent setup --target codex --dry-run --project-root "$TMP_PROJECT"

# Apply Codex marker block
amp agent setup --target codex --apply --project-root "$TMP_PROJECT"
```

### Doctor checks

**VERIFIED:** `amp doctor` reports `agent-setup` findings for marker block presence (Claude, Codex), flattened Cursor rule presence, and missing projection files.

### How to undo

| Surface | Undo |
|---------|------|
| Claude Code | Remove the AMP marker block from `CLAUDE.md` (content between `<!-- amp:agent-setup:claude-code:v1:start -->` and `<!-- amp:agent-setup:claude-code:v1:end -->`) |
| Cursor | Delete `.cursor/rules/from-amp/amp-projection.mdc` |
| Codex | Remove the AMP marker block from `AGENTS.md` (content between `<!-- amp:agent-setup:codex:v1:start -->` and `<!-- amp:agent-setup:codex:v1:end -->`) |

### Invariant 4 / 6 notes

- **Invariant 4:** Cursor setup writes only under `.cursor/rules/from-amp/` via path guards.
- **Invariant 6:** `.amp/local/` and `.amp/runtime/` remain gitignored; Claude uses import pointers only; Cursor and Codex receive inlined content in harness files.

### Automated E2E

**VERIFIED:** `src/amp/integration/agent-setup-local.test.ts` — init → capture/consolidate → local projection apply → Claude/Cursor setup dry-run/apply → doctor ok → git clean.

---

## Live gbrain projection verification (opt-in)

**Outside the offline acceptance gate.** Use only after `npm run amp:acceptance` passes and you have backed up your real gbrain database.

### Safety gates

| Env / flag | Required for | gbrain mutation |
|------------|--------------|-----------------|
| `AMP_LIVE_GBRAIN=1` | Opt-in integration test | **No** (read-only dry-run path) |
| `AMP_CONFIRM_LIVE_GBRAIN_WRITE=1` | Sentinel frame setup in test | **Yes** (one AMP-owned page) |
| `--source gbrain` | CLI render | **No** during render (read-only adapter) |

AMP never auto-runs `gbrain init --migrate-only`. When doctor warns, run migration manually, then re-run preflight.

### Operator sequence

```bash
# 1. Offline gate (required)
npm run amp:acceptance

# 2. Backup (PROVISIONAL — filesystem copy)
gbrain config show   # note database_path
cp -a "$DATABASE_PATH" "$BACKUP_DIR/brain.pglite.backup.$(date +%Y%m%d)"

# 3. Preflight + optional manual migration
amp gbrain-preflight --knowledge gbrain
# if WARN [gbrain-migrate]:
gbrain init --migrate-only
amp gbrain-preflight --knowledge gbrain

# 4. Temp project (avoid real ~/.amp)
TMP_BASE=$(mktemp -d)
TMP_PROJECT="$TMP_BASE/project"
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"
export AMP_KNOWLEDGE_BACKEND=gbrain
amp init --project-root "$TMP_PROJECT"

# 5. Read-only opt-in test (no gbrain writes)
AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-projection-live.test.ts

# 6. Optional sentinel (explicit gbrain write + best-effort cleanup)
AMP_LIVE_GBRAIN=1 AMP_CONFIRM_LIVE_GBRAIN_WRITE=1 \
  npm test -- src/amp/integration/gbrain-projection-live.test.ts

# 7. Manual CLI spot-check
amp projection render --source gbrain --dry-run --project-root "$TMP_PROJECT"
```

**Sentinel ids:** `live-proj-{timestamp}-{random}` → slug `amp/frames/h.{hex}`. Cleanup uses `delete_page` with **PROVISIONAL** soft-delete semantics (~72h recoverable).

**VERIFIED:** test skipped by default in CI. **PROVISIONAL:** live read/render until operator run passes.

See `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-projection-live-verification.md`.

---

## Placeholder dry-run (no stores required)

For pipeline/path/budget parity without reading runtime or knowledge:

```bash
amp projection render --dry-run --project-root "$TMP_PROJECT"
```

Uses `PlaceholderProjectionSource` — empty bodies, zero token counts, apply blocked.

---

## Runtime store lifecycle

**VERIFIED:** Local projection CLI rendering opens `RuntimeStore` for `--source local` and closes it in a `finally` block after materialization (success or error). See `src/amp/cli/projection.ts`.

---

## Related reports

- `tools/cursor-sdk-amp-orchestrator/reports/amp-local-projection-materialization.md` — Wave 15 implementation report and claim labels
- `tools/cursor-sdk-amp-orchestrator/reports/amp-local-agent-setup.md` — Wave 16 agent-access setup report and claim labels
- `tools/cursor-sdk-amp-orchestrator/reports/amp-local-agent-live-verification.md` — Claude/Cursor live verification matrix
- `tools/cursor-sdk-amp-orchestrator/reports/amp-codex-agent-setup-live.md` — Codex live verification protocol and results
- `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-projection-live-verification.md` — opt-in live gbrain projection verification
- `tools/cursor-sdk-amp-orchestrator/reports/amp-gbrain-live.md` — gbrain MCP adapter round trip
