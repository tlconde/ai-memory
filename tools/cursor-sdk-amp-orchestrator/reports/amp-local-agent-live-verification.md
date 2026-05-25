# AMP Local Agent Setup — Live Verification Report

> **Date:** 2026-05-25
> **Base:** `ralph/amp-agent-access-clean` @ `bbce1cf` (offline CLI run); live harness proofs updated post Wave 16 / Codex setup
> **Scope:** Wave 16 local agent-access setup — offline CLI wiring, live session context load (Claude Code, Cursor), doctor, Invariant 6

---

## Verdict

**Offline CLI path for local agent setup is VERIFIED end-to-end** in a temp git project with injected `AMP_USER_ROOT`.

**Live session context loading is VERIFIED** for:

| Surface | Mechanism | Label |
|---------|-----------|-------|
| Claude Code | `CLAUDE.md` marker block + `@.amp/local/*.md` imports | **VERIFIED** |
| Cursor | Flattened `.cursor/rules/from-amp/amp-projection.mdc` | **VERIFIED** (workspace root = temp project) |
| Codex | `AGENTS.md` marker block with inlined bodies | **VERIFIED** — see `amp-codex-agent-setup-live.md` |

**UNKNOWN / not used:** Codex `@import`; Cursor recursive `@` imports in projection paths.

**Not in acceptance gate:** Live harness proofs remain opt-in operator checks; `npm run amp:acceptance` does not require IDE sessions.

---

## Environment (offline CLI run)

| Item | Value |
|------|-------|
| Repo | `/Users/dev/Dev/Github/ai-memory` |
| CLI entry | `amp …` (or `node dist/cli/index.js amp …` after `npm run build`) |
| Temp project | `/tmp/amp-live-verify-rIRoo0/project` |
| Injected global root | `AMP_USER_ROOT=/tmp/amp-live-verify-rIRoo0/amp-user-root` |
| Knowledge backend | `AMP_KNOWLEDGE_BACKEND=in-memory` (projection apply only) |
| Git | `git init` in temp project; no commits |

---

## Manual procedure (offline CLI — executed)

```bash
# From repo root
npm run build
npm run amp:acceptance   # re-run at report commit time

TMP_BASE=/tmp/amp-live-verify-rIRoo0
TMP_PROJECT="$TMP_BASE/project"
export AMP_USER_ROOT="$TMP_BASE/amp-user-root"
export AMP_KNOWLEDGE_BACKEND=in-memory

amp init --project-root "$TMP_PROJECT"
cd "$TMP_PROJECT" && git init

# Seed runtime queue (two CLI invocations; persists in project runtime SQLite)
amp capture --project-root "$TMP_PROJECT" \
  --scope project --kind preference --text "Live verify preference: prefer explicit return types."
amp capture --project-root "$TMP_PROJECT" \
  --scope project --kind episodic_signal --text "Live verify runtime note: queued for projection."

amp projection render --source local --dry-run --project-root "$TMP_PROJECT"
amp projection render --source local --apply --project-root "$TMP_PROJECT"

amp agent setup --target claude-code --dry-run --project-root "$TMP_PROJECT"
amp agent setup --target claude-code --apply --project-root "$TMP_PROJECT"

amp agent setup --target cursor --dry-run --project-root "$TMP_PROJECT"
amp agent setup --target cursor --apply --project-root "$TMP_PROJECT"

amp doctor --project-root "$TMP_PROJECT"

git -C "$TMP_PROJECT" status --short --untracked-files=all
```

---

## Step results

### 1. CLI build / acceptance

| Check | Result | Notes |
|-------|--------|-------|
| `npm run build` | **PASS** | Required before manual CLI invocations |
| `npm run amp:acceptance` | **PASS** | Exit 0; typecheck, build, test, conformance INV-1..6, CLI smoke — no live harness sessions |

### 2. Temp project init

| Check | Result | Notes |
|-------|--------|-------|
| `amp init` | **PASS** | Created `.amp/config.yaml`, `.amp/local/`, `.amp/runtime/`, gitignore lines |
| `project_ref` | `project` | From config |
| Real `~/.amp` touched | **No** | Global paths resolved under injected `AMP_USER_ROOT` |

### 3. Local projection apply (`AMP_USER_ROOT` injected)

| Check | Result | Notes |
|-------|--------|-------|
| `--source local --dry-run` | **PASS** | Planned four writes (2 global under `AMP_USER_ROOT`, 2 project under `.amp/local/`) |
| `--source local --apply` | **PASS** | Four files written atomically |
| Global projection | `$AMP_USER_ROOT/projection/global.md` | Present |
| Global runtime | `$AMP_USER_ROOT/runtime/global.md` | Present |
| Project projection | `.amp/local/projection.md` | Present (empty body — in-memory knowledge empty across CLI processes) |
| Project runtime | `.amp/local/runtime.md` | Present; contains both captured queue items |

### 4. Claude Code project `CLAUDE.md` import wiring

| Check | Result | Notes |
|-------|--------|-------|
| `--target claude-code --dry-run` | **PASS** | Planned marker block write |
| `--target claude-code --apply` | **PASS** | `CLAUDE.md` created |
| Marker block content | **PASS** | `@.amp/local/projection.md` and `@.amp/local/runtime.md` between v1 markers |
| **Live Claude Code session loads wired context** | **VERIFIED** | Operator live probe confirmed `@` imports resolve at session start |

### 5. Cursor flattened `.mdc` rule wiring

| Check | Result | Notes |
|-------|--------|-------|
| `--target cursor --dry-run` | **PASS** | Planned write to `.cursor/rules/from-amp/amp-projection.mdc` |
| `--target cursor --apply` | **PASS** | File created under `from-amp/` root (Invariant 4) |
| Flattened content | **PASS** | Inlines projection + runtime sections |
| **Live Cursor session applies flattened rule** | **VERIFIED** | Operator live probe with temp project as workspace root |
| Cursor recursive `@` imports | **UNKNOWN / not used** | AMP does not rely on recursive `@` chains |

### 6. Codex `AGENTS.md` marker block

| Check | Result | Notes |
|-------|--------|-------|
| Live load via `amp agent setup --target codex` | **VERIFIED** | See `amp-codex-agent-setup-live.md` |
| Codex `@import` | **UNKNOWN / not used** | AMP inlines bodies; no `@path` imports in marker block |

### 7. Doctor output after setup

| Check | Result | Notes |
|-------|--------|-------|
| `agent-setup` findings | **OK** | Projection files present; Claude marker block present; Cursor `.mdc` present |
| `gitignore-protection` | **OK** | `.amp/local/`, `.amp/runtime/` git-ignored |
| Overall doctor exit | **0** | `OK Doctor finished with no blocking errors.` |

**PROVISIONAL:** Doctor SSA/SAS spec resolution depends on discovering the ai-memory repo root from the built CLI location. Treat cross-cwd doctor behavior as environment-sensitive until conformance covers temp-project-only cwd.

### 8. Git status / Invariant 6

| Check | Result | Notes |
|-------|--------|-------|
| `.amp/local/` in status | **Absent** | Gitignored — **Invariant 6 pass** |
| `.amp/runtime/` in status | **Absent** | Gitignored — **Invariant 6 pass** |
| Harness/agent wiring files visible | Expected | `CLAUDE.md`, `.cursor/rules/from-amp/amp-projection.mdc` are operator-facing untracked files |

---

## Claim label table

| # | Claim | Label | Evidence |
|---|-------|-------|----------|
| 1 | Offline acceptance gate passes | **VERIFIED** | `npm run amp:acceptance` exit 0 |
| 2 | `amp init` creates protected AMP dirs in temp project | **VERIFIED** | Manual init + gitignore contents |
| 3 | Local projection dry-run/apply writes four canonical paths with injected `AMP_USER_ROOT` | **VERIFIED** | Manual apply; files on disk |
| 4 | Runtime queue persists across CLI capture → render | **VERIFIED** | Capture text in `.amp/local/runtime.md` |
| 5 | Claude marker block written with correct `@` import paths | **VERIFIED** | `CLAUDE.md` contents |
| 6 | Claude Code live session loads AMP-wired context | **VERIFIED** | Operator live probe |
| 7 | Cursor flattened `.mdc` written under `from-amp/` only | **VERIFIED** | Path + doctor OK |
| 8 | Cursor live session loads flattened rule context | **VERIFIED** | Operator live probe (workspace root = temp project) |
| 9 | Codex live session loads `AGENTS.md` marker content | **VERIFIED** | `amp-codex-agent-setup-live.md` |
| 10 | Codex `@import` / Cursor recursive `@` in projection paths | **UNKNOWN / not used** | AMP design avoids unverified import chains |
| 11 | Doctor agent-setup checks pass after wiring | **VERIFIED** | Doctor output |
| 12 | Invariant 6 — AMP-managed paths absent from `git status` | **VERIFIED** | Status output |
| 13 | Cross-process durable in-memory knowledge for projection bodies | **PROVISIONAL** | Known Wave 15 gap |
| 14 | Live gbrain / Hermes in acceptance gate | **VERIFIED absent** | Gate stays offline |

---

## Residual risks

1. **Doctor cwd sensitivity (PROVISIONAL)** — SSA/SAS spec discovery may fail when shell cwd is the temp project rather than the ai-memory repo root.
2. **Empty projection body across CLI (PROVISIONAL)** — Consolidated knowledge does not appear in project projection when only separate CLI invocations are used without in-process consolidate injection.
3. **Harness files untracked by design** — `CLAUDE.md`, `.cursor/rules/from-amp/amp-projection.mdc`, and `AGENTS.md` may appear in git status; operators decide whether to commit them (outside Invariant 6 scope).
4. **Cursor workspace root** — Live Cursor load requires opening the temp project as workspace root, not the ai-memory repo.

---

## Related docs

- `docs/guides/AMP_LOCAL_TESTING.md` — operator workflow
- `tools/cursor-sdk-amp-orchestrator/reports/amp-local-agent-setup.md` — Wave 16 implementation report
- `tools/cursor-sdk-amp-orchestrator/reports/amp-codex-agent-setup-live.md` — Codex live verification
