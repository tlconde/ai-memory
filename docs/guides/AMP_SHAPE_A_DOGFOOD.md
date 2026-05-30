# AMP Shape A Dogfood Walkthrough

> **Status:** active operator walkthrough — verified against `src/amp/cli/index.ts` and `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.
> **Date:** 2026-05-31
> **Scope:** Shape A (local-only, §11.1). No live gbrain, no cloud surfaces.
> **Roadmap milestone:** `M-DOGFOOD-A-walkthrough` (`docs/specs/AMP_ROADMAP.md` Track 2).
> **Companion:** `docs/guides/AMP_LOCAL_TESTING.md` — prior live-pass record for Claude Code and Cursor session load.

This walkthrough is grounded in `src/amp/cli/index.ts` and the acceptance docs — not assumptions.

---

## AMP CLI registry (from `index.ts`)

Invoke via `amp …` or `ai-memory amp …` after `npm run build` (bins: `amp` → `dist/cli/amp-entry.js`).

| Command | Flags / args |
|--------|----------------|
| `amp init` | `--project-root`, `--force` |
| `amp doctor` | `--project-root` |
| `amp gbrain-preflight` | `--project-root`, `--knowledge` |
| `amp capture` | **`--content`** (required), `--scope` (default `project`), `--project-ref`, `--project-root`, `--surface` (default `cursor`) |
| `amp consolidate` | `--project-root`, `--knowledge`, `--confirm-live-gbrain-write`, `--live-gbrain` |
| `amp retrieve` | `--scope`, `--project-ref`, `--query`, `--project-root`, `--knowledge` |
| `amp propagate` | `--project-root`, `--targets` (comma: `cursor`, `claude-code`, `hermes`) |
| `amp projection render` | `--project-root`, `--source` (`local` \| `placeholder` \| `gbrain`), `--dry-run`, **`--apply`** |
| `amp upstream` | `subscribe`, `unsubscribe`, `list`, `review`, `apply`, `dismiss`, `poll` |
| `amp procedural` | `import gstack <path>`, `revoke gstack`, `list` |
| `amp agent setup` | **`--target`** (`claude-code` \| `cursor` \| `codex`), `--project-root`, `--dry-run`, `--apply` |
| `amp knowledge status` | `--project-root`, `--json` |
| `amp knowledge list` | `--project-root`, `--json`, `--kind`, `--scope`, `--limit` |
| `amp runtime status` | (none) |
| `amp runtime inspect` | `--project-root`, `--entity`, `--json` |
| `amp runtime correct` | **`--id`**, **`--note`**, `--project-root`, `--json` |
| `amp runtime seed` | **`--file`**, `--project-root`, `--json` |
| `amp runtime graduation plan` | `--project-root`, `--entity`, `--json` |
| `amp runtime graduation apply` | **`--id`**, `--project-root`, `--json` |
| `amp optimize` | `--project-root`, `--dry-run`, `--verbose` |
| `amp status` | (none) |

**Shape A routing note:** Omit `--knowledge` and unset `AMP_KNOWLEDGE_BACKEND` so `consolidate` / `--source local` render use **persistent** `<project>/.amp/runtime/knowledge.db` (not live gbrain). If `AMP_KNOWLEDGE_BACKEND=gbrain` is set in your shell, consolidate defaults to live gbrain — outside offline acceptance scope.

Both Claude Code and Cursor SAS declare `injection_modes: [filesystem-native]` only (`sas-files/claude-code.yaml`, `sas-files/cursor.yaml`). AMP does not claim MCP or briefing injection for this walkthrough.

---

## Prerequisites

```bash
# From ai-memory repo (or linked install)
npm run build

export PROJECT=/path/to/your/real/project

# Shape A local-only — do NOT hit live gbrain
unset AMP_KNOWLEDGE_BACKEND

# Optional: isolate global projection files from ~/.amp
# export AMP_USER_ROOT="$HOME/.amp-dev"
```

**Label:** **VERIFIED** — local-persistent routing when no explicit backend (`knowledge-backend.ts` precedence). **PROVISIONAL** — your shell env if `AMP_KNOWLEDGE_BACKEND` is still set.

---

### Step 1 — `amp init` in your project

```bash
cd "$PROJECT"
amp init --project-root "$PROJECT"
amp doctor --project-root "$PROJECT"   # dogfood_ready block summarizes Shape A readiness
```

Creates `.amp/config.yaml`, `.amp/runtime/`, `.amp/local/`, gitignore entries (Invariant 6).

| | |
|--|--|
| **Status** | **VERIFIED** — acceptance gate smoke-tests `init` + `doctor` (`AMP_V1_ACCEPTANCE_REPORT.md` gate steps 7–8) |
| **Falsifiable assertion** | `test -f "$PROJECT/.amp/config.yaml"` exits 0 **and** `amp doctor` exits 0 with no ERROR lines |

---

### Step 2 — Capture a scoped preference

```bash
PREF="Prefer two-space indentation in TypeScript files in this repo."
amp capture \
  --content "$PREF" \
  --scope project \
  --project-root "$PROJECT" \
  --surface cursor
```

Writes to runtime queue only (`capture.ts` — no harness / projection writes).

| | |
|--|--|
| **Status** | **VERIFIED** — preference vertical slice + capture CLI tests; queue persists in `.amp/runtime/runtime.db` across CLI invocations |
| **Falsifiable assertion** | CLI output contains `Captured preference` and a `signal_id:` line |

Optional check:

```bash
amp knowledge status --project-root "$PROJECT"   # frames may still be 0 pre-consolidate
```

---

### Step 3 — Consolidate

```bash
amp consolidate --project-root "$PROJECT"
```

**Do not** pass `--knowledge gbrain`. Default path writes durable frames to `.amp/runtime/knowledge.db` beside `runtime.db`.

| | |
|--|--|
| **Status** | **VERIFIED** — durable local capture loop in acceptance gate; `consolidateNow` against local SQLite |
| **Falsifiable assertion** | Consolidate output reports processed ≥ 1 **and** `amp knowledge list --project-root "$PROJECT"` shows at least one frame whose content matches `$PREF` (substring match) |

---

### Step 4 — `amp projection render --source local --apply`

Dry-run first (default without `--apply`):

```bash
amp projection render --source local --dry-run --project-root "$PROJECT"
```

Then apply:

```bash
amp projection render --source local --apply --project-root "$PROJECT"
```

Materializes four files, including:

- `$PROJECT/.amp/local/projection.md`
- `$PROJECT/.amp/local/runtime.md`
- plus global files under `$AMP_USER_ROOT` or `~/.amp/` if unset

| | |
|--|--|
| **Status** | **VERIFIED** — `projection-local-materialization.test.ts`; `--source local --apply` requires explicit `--apply` (`projection.ts`) |
| **Falsifiable assertion** | `grep -F "$PREF" "$PROJECT/.amp/local/projection.md"` exits 0 **and** render report lists project projection as written/applied with `ok: true` semantics (no ERROR / blocked) |

---

### Step 5 — Wire projection into harnesses (§4.2.2)

#### Claude Code — **VERIFIED**

Claude uses `@` imports in project `CLAUDE.md` (§4.2.2; live-verified in `AMP_LOCAL_TESTING.md`):

```bash
amp agent setup --target claude-code --dry-run --project-root "$PROJECT"
amp agent setup --target claude-code --apply --project-root "$PROJECT"
```

Expected marker block includes:

```markdown
@.amp/local/projection.md
@.amp/local/runtime.md
```

| | |
|--|--|
| **Status** | **VERIFIED** — `agent-setup-local.test.ts`; Claude `@path` import **VERIFIED** (offline wiring + live session load per `AMP_LOCAL_TESTING.md`) |
| **Falsifiable assertion** | `grep -F '@.amp/local/projection.md' "$PROJECT/CLAUDE.md"` exits 0 |

#### Cursor — **VERIFIED** (wiring), not `@import`

Cursor does **not** use recursive `@` imports for projections. AMP inlines into:
`.cursor/rules/from-amp/amp-projection.mdc`

```bash
amp agent setup --target cursor --dry-run --project-root "$PROJECT"
amp agent setup --target cursor --apply --project-root "$PROJECT"
```

| | |
|--|--|
| **Status** | **VERIFIED** — filesystem-native emit to `.cursor/rules/from-amp/` (§9.8); flattened `.mdc` strategy (Wave 16). **PROVISIONAL** for *your* live Cursor session unless you open `$PROJECT` as workspace root and confirm rule load (same caveat as acceptance report residual risk #3) |
| **Falsifiable assertion** | `test -f "$PROJECT/.cursor/rules/from-amp/amp-projection.mdc"` **and** `grep -F "$PREF" "$PROJECT/.cursor/rules/from-amp/amp-projection.mdc"` exit 0 |

`amp propagate` is **not** this step — it compiles **procedure registry** skills to `from-amp/` roots, not preference projections.

---

### Step 6 — Open harnesses; confirm preference visible

**Claude Code:** start a new session in `$PROJECT`; ask e.g. "What indentation preference does AMP project memory record?"

**Cursor:** open `$PROJECT` as workspace root; new Agent chat with same question.

| | |
|--|--|
| **Status** | **VERIFIED** (filesystem) — preference text is on disk in projection artifacts Claude imports and Cursor inlines. **PROVISIONAL** (live harness) — acceptance report: "whether Cursor, Claude Code… actually load emitted artifacts in a live session" until you confirm in-session; `AMP_LOCAL_TESTING.md` records prior live passes for both |
| **Falsifiable assertion** | Model reply cites two-space / `$PREF` substance **without** you pasting `$PREF` into the prompt |

---

### Step 7 — Cross-surface correction (value-prop #3)

Shape A operator path (filesystem-native only — no harness-native memory write):

```bash
CORRECTED="Prefer four-space indentation in TypeScript files in this repo."

amp capture \
  --content "$CORRECTED" \
  --scope project \
  --project-root "$PROJECT" \
  --surface claude-code

amp consolidate --project-root "$PROJECT"
amp projection render --source local --apply --project-root "$PROJECT"

# Claude: @imports pick up file changes on next session — no re-setup needed
# Cursor: inlined .mdc must be refreshed
amp agent setup --target cursor --apply --project-root "$PROJECT"
```

Then re-open **both** harnesses (new sessions) and ask the same indentation question.

Alternative typed correction path (runtime semantics, not legacy preference queue):

```bash
amp runtime inspect --project-root "$PROJECT" --json   # copy <entity-id> from output
amp runtime correct --id "<entity-id>" --note "$CORRECTED" --project-root "$PROJECT"
# then consolidate → render → cursor re-apply as above
```

| | |
|--|--|
| **Status** | **VERIFIED** (substrate + disk) — re-consolidate + re-render updates `.amp/local/projection.md`; Cursor re-apply updates `.mdc`. **PROVISIONAL** (value-prop #3 live) — spec falsifiable test assumes cross-surface latency; offline acceptance proves filesystem path, not automatic in-session refresh on both harnesses without operator re-open / Cursor re-apply |
| **Falsifiable assertion** | `grep -F "four-space" "$PROJECT/.amp/local/projection.md"` **and** `grep -F "four-space" "$PROJECT/.cursor/rules/from-amp/amp-projection.mdc"` exit 0; **and** both harnesses answer with four-space (not two-space) in fresh sessions without re-pasting the preference |

Git sanity (Invariant 6):

```bash
cd "$PROJECT" && git status --short --untracked-files=all | grep -E '\.amp/' && echo FAIL || echo PASS
```

---

## Honest limitations — what AMP cannot do today

| Limitation | Label |
|------------|--------|
| **Cloud surfaces** (claude.ai web, Cowork, ChatGPT cloud) | **Briefing-only** in Shape A — no daemon MCP write path; Invariant 3 deferred (INV-3) |
| **Live gbrain** as default consolidate backend when `AMP_KNOWLEDGE_BACKEND` unset in some configs | **PROVISIONAL** — `resolveKnowledgeBackend()` defaults to `gbrain` *only when* `--knowledge` or env is explicit; omit both for local SQLite. Live `gbrain serve` MCP is opt-in, not acceptance-gated |
| **gbrain search/read/delete MCP semantics live** | **PROVISIONAL** per acceptance report |
| **Hermes / Codex / Gemini / Windsurf** harness adapters | **Out of §9.8 verified scope** — stubs may exist; not acceptance-gated |
| **Scheduled consolidation/propagation daemons** | **Partial** — synchronous CLI only; cron daemons not acceptance-gated |
| **Cross-harness correction without re-render (and Cursor re-apply)** | Not automatic — filesystem-native injection requires regeneration; Cursor does not `@import` projection files |
| **Cursor recursive `@` in projection paths** | **Not used / UNKNOWN** — AMP flattens to `.mdc` instead |
| **In-memory knowledge across separate shell processes** | **Not durable** — use default `knowledge.db`, not `--knowledge in-memory` |
| **Priority-based projection truncation** | **PROVISIONAL** — budget gate exists; spec §4.2.3 dropping order unfinished |
| **Live harness session load** | **PROVISIONAL** until you verify in your project (prior spikes VERIFIED in orchestrator reports, not re-run in acceptance gate) |
| **Live gbrain except `graph_traversal: wrapped`** | **PROVISIONAL** — offline CI uses fake transport; `graph_traversal` promotion is wrapped, not "native live verified" |

---

**Quick sanity before you start:** `npm run amp:acceptance` from the ai-memory repo (**VERIFIED** offline gate). Then run steps 1–7 in `$PROJECT` with `AMP_KNOWLEDGE_BACKEND` unset for true Shape A local-only behavior.
