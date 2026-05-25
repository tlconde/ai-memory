# AMP Claude Code Projection Import Setup — Design (AMP-PROJ-04)

> **Date:** 2026-05-25  
> **Task:** AMP-PROJ-04 — design how AMP wires Claude Code `CLAUDE.md` imports without overwriting user-authored content  
> **Base:** `ralph/amp-v1-v1-31` @ `43595df`  
> **Scope:** Report-only design. No projection materialization, no live harness automation, no acceptance-gate changes.

---

## 1. Decision summary

AMP should wire Claude Code to AMP projections through **explicit, opt-in setup** via a new CLI command:

```bash
amp projection setup claude-code
```

**Manual instructions** and **`amp doctor` verification** support the command; they do not replace it.

**`amp publish`** remains a separate, optional path for teams that want a **frozen, user-owned, potentially git-tracked** import stub — not the default v1.5b wiring mechanism.

| Mechanism | Role | Default? |
|---|---|---|
| `amp projection setup claude-code` | Idempotent marker-block wiring in harness memory files | **Yes — primary** |
| `amp doctor` (Claude import checks) | Read-only verification of wiring + Invariant 6 | **Yes — required companion** |
| Manual copy/paste instructions | Fallback when operator declines auto-setup or file is hand-curated | Secondary |
| `amp publish projection-imports --to <path>` | Frozen export outside AMP management (Invariant 6 exception) | Opt-in only |

**Hard rule:** AMP never silently edits user-owned harness files (`CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md`). All writes require an explicit subcommand with `--apply` (default is `--dry-run`).

---

## 2. External claims (Anthropic Claude Code memory)

Source: [How Claude remembers your project](https://docs.anthropic.com/en/docs/claude-code/memory) (fetched 2026-05-25).

| Claim | Label |
|---|---|
| `CLAUDE.md` files import additional files with `@path/to/import` | **VERIFIED** |
| Relative paths resolve relative to the **file containing the import**, not CWD | **VERIFIED** |
| Absolute paths are allowed (including home-directory paths) | **VERIFIED** |
| Imported files may recursively import others, max depth **5 hops** | **VERIFIED** |
| Imports expand and load into context **at session launch** | **VERIFIED** |
| Splitting content into `@path` imports helps organization but **does not reduce context** — imported files still load at launch | **VERIFIED** |
| Project memory may live at `./CLAUDE.md` or `./.claude/CLAUDE.md` | **VERIFIED** |
| Personal project prefs may live in gitignored `./CLAUDE.local.md` | **VERIFIED** |
| User-level memory lives at `~/.claude/CLAUDE.md` | **VERIFIED** |
| Repos with `AGENTS.md` may use `@AGENTS.md` in `CLAUDE.md` to share instructions | **VERIFIED** |
| First encounter of **external** imports shows an approval dialog; declining disables imports and the dialog does not reappear | **VERIFIED** |
| Auto memory lives under `~/.claude/projects/<hash>/memory/` and is separate from `CLAUDE.md` | **VERIFIED** |
| Whether AMP import paths count as "external" for the approval dialog in all Claude Code versions | **UNKNOWN** |
| Exact behavior if operator previously declined imports for a project | **PROVISIONAL** — docs say disabled until user re-enables; no AMP-specific reset path verified |

---

## 3. Invariant 6 alignment

From `docs/specs/AMP_CONSOLIDATED_SPEC.md` §Invariant 6:

| Path class | Examples | AMP may write? | Git-trackable? |
|---|---|---|---|
| Global AMP-managed | `~/.amp/projection/global.md`, `~/.amp/runtime/global.md` | Yes (regenerated) | Must not be tracked |
| Project AMP-managed | `<project>/.amp/local/projection.md`, `runtime.md` | Yes (regenerated) | Must not be tracked (`amp init` adds `.amp/local/` to `.gitignore`) |
| Harness user-owned | `./CLAUDE.md`, `./CLAUDE.local.md`, `~/.claude/CLAUDE.md` | **Only via explicit setup command with `--apply`** | User choice |
| Published export | User path from `amp publish --to` | One-time export; then user-owned | User choice |

**Design invariant:** projection **content** materializes only under AMP-managed paths. Harness files receive **import pointers only**, inside a delimited marker block that AMP may update idempotently after explicit operator consent.

**Falsifiable test (future implementation):** after `amp projection setup claude-code --apply` and full projection regeneration, `git status --short` shows no changes under `.amp/local/` paths that are not gitignored, and no AMP-managed file appears as tracked. Harness file edits are intentional operator actions via `--apply`.

---

## 4. Projection import targets (from spec §4.2.2)

AMP-managed sources (written by future materialization, not this task):

| Scope | Projection file | Runtime file |
|---|---|---|
| Global (user) | `~/.amp/projection/global.md` | `~/.amp/runtime/global.md` |
| Project | `<project>/.amp/local/projection.md` | `<project>/.amp/local/runtime.md` |

Proposed import lines (paths as seen from each harness file location):

**Global — `~/.claude/CLAUDE.md`:**

```markdown
@~/.amp/projection/global.md
@~/.amp/runtime/global.md
```

**Project — `./CLAUDE.local.md` (preferred) or `./CLAUDE.md` / `./.claude/CLAUDE.md`:**

```markdown
@.amp/local/projection.md
@.amp/local/runtime.md
```

**Label:** VERIFIED — absolute `~/.amp/...` and project-relative `.amp/local/...` paths are valid per Anthropic import rules.

**Label:** PROVISIONAL — if wiring `./.claude/CLAUDE.md`, relative imports must be `@../.amp/local/projection.md` (resolve relative to containing file). Setup command must compute paths from the chosen target file.

---

## 5. Evaluated setup approaches

### 5.1 Manual instructions only

| Pros | Cons |
|---|---|
| Zero risk of clobbering user content | High operator friction; wiring drifts from doctor checks |
| No new CLI surface | Does not scale across global + project scopes |

**Verdict:** Required as **fallback output** (`--dry-run`, doctor remediation text), not sufficient alone.

### 5.2 Explicit `amp projection setup claude-code`

| Pros | Cons |
|---|---|
| Repeatable, testable, idempotent marker updates | Touches user-owned files — must be opt-in |
| Matches spec §12.6 doctor "harness import wiring" | Requires careful merge semantics |
| Can prefer `CLAUDE.local.md` to avoid team-shared file conflicts | First-run Claude approval dialog may block silently |

**Verdict:** **Primary mechanism.**

### 5.3 `amp publish` / export flow

| Pros | Cons |
|---|---|
| Clean Invariant 6 story — export is frozen and user-owned | Extra step; stale unless republished |
| Teams can commit a small tracked stub (e.g. `.claude/amp-imports.md`) | Not live-linked to regeneration |
| Good for air-gapped or review-before-apply workflows | Wrong default for v1.5b "live projection" model |

**Verdict:** **Opt-in adjunct**, e.g. `amp publish projection-imports --harness claude-code --to ./docs/amp-claude-imports.snippet.md`.

---

## 6. Proposed command UX (exact)

### 6.1 Command tree

```text
amp projection setup claude-code [options]
amp projection setup claude-code --help
```

Placement: under new top-level group `amp projection` (distinct from `amp propagate`, which emits `from-amp/` adapter artifacts).

### 6.2 Flags

| Flag | Default | Purpose |
|---|---|---|
| `--project-root <path>` | `cwd` | Project for project-scoped wiring |
| `--scope global` | off | Wire `~/.claude/CLAUDE.md` |
| `--scope project` | on when invoked inside initialized project | Wire project imports |
| `--target auto` | `auto` | Resolve best project file: `CLAUDE.local.md` → `.claude/CLAUDE.md` → `CLAUDE.md` |
| `--target claude.local` | — | Force `./CLAUDE.local.md` |
| `--target claude.md` | — | Force `./CLAUDE.md` |
| `--target dot-claude` | — | Force `./.claude/CLAUDE.md` |
| `--dry-run` | **on** | Print planned edits; no writes |
| `--apply` | off | Perform writes (mutually exclusive with treating dry-run as default) |
| `--force-new-file` | off | Create missing target file (still requires `--apply`) |
| `--json` | off | Machine-readable plan/result |

**Scope resolution when both `--scope global` and `--scope project` omitted:** run **project** scope if `.amp/config.yaml` exists; always offer global in interactive mode.

### 6.3 Example operator flows

**Preview project wiring (safe default):**

```bash
cd /path/to/repo
amp init                                    # future: also gitignore .amp/local/
amp projection setup claude-code --dry-run
```

**Apply project wiring to gitignored local file:**

```bash
amp projection setup claude-code --scope project --target claude.local --apply
```

**Apply global + project in one invocation:**

```bash
amp projection setup claude-code --scope global --scope project --apply
```

**Preview only:**

```bash
amp projection setup claude-code --dry-run --json
```

Expected stdout (human mode, dry-run excerpt):

```text
AMP Claude Code projection setup (dry-run)

Project scope (/path/to/repo):
  Target: CLAUDE.local.md (preferred — gitignored personal file)
  Action: create file + insert amp marker block
  Block:
    @.amp/local/projection.md
    @.amp/local/runtime.md

Global scope:
  Target: ~/.claude/CLAUDE.md
  Action: append marker block (existing 142 lines preserved)

Run with --apply to write. Re-run is idempotent.
```

### 6.4 Marker block format

AMP-owned editable region inside user files:

```markdown
<!-- amp:projection-imports:v1:start -->
## AMP projections
<!-- Managed by: amp projection setup claude-code — do not edit imports manually; re-run setup after path changes. -->

@.amp/local/projection.md
@.amp/local/runtime.md
<!-- amp:projection-imports:v1:end -->
```

Global block uses `@~/.amp/projection/global.md` and `@~/.amp/runtime/global.md`.

**Merge rules:**

1. If markers exist → replace **only** inner content between markers (idempotent).
2. If file exists, no markers → **do not write** unless `--apply` **and** (`--force-marker-insert` or interactive confirm). Default: append markers after existing content with leading `\n\n`.
3. If file exists and is non-empty with conflicting `@.amp/` imports outside markers → **warning + dry-run failure**; operator must resolve manually or use `--replace-legacy-amp-imports` (future flag, **PROVISIONAL**).
4. If target missing → create minimal file containing markers **only when** `--apply --force-new-file`.
5. Never truncate or rewrite content outside the marker block.
6. Never modify `AGENTS.md`, `.ai/`, or other non-Claude harness files.

### 6.5 What setup does **not** do

- Does not materialize projection file content (separate `amp projection refresh` / consolidation pipeline — out of scope).
- Does not run Claude Code or trigger import approval UI.
- Does not add live-service steps to `npm run amp:acceptance`.
- Does not edit tracked team `CLAUDE.md` unless operator explicitly passes `--target claude.md --apply`.

---

## 7. `amp doctor` extensions (read-only)

New finding category: `claude-projection-imports`.

| Check | Level | Label |
|---|---|---|
| `.amp/local/` listed in `.gitignore` | error if missing | aligns with Invariant 6 |
| Projection files exist | warning if missing (setup before materialization) | PROVISIONAL until materialization lands |
| Marker block or canonical `@.amp/local/` imports present in resolved project target | warning if project initialized but unwired | — |
| Global `@~/.amp/projection/global.md` in `~/.claude/CLAUDE.md` when global scope enabled in config | info/warning | — |
| Import paths point to AMP-managed locations (not `from-amp/`) | ok | — |
| Projection mtime vs consolidation revision (staleness) | warning | per spec §12.6 |

Doctor remains offline-safe — no Claude Code process spawn required.

---

## 8. Relationship to `amp init`

Future `amp init` (v1.5b) should:

1. Append `.amp/local/` to `.gitignore` if missing (Invariant 6).
2. Create empty projection/runtime placeholders or defer to first refresh.
3. Print **next step** hint: `amp projection setup claude-code --dry-run`.

**Init must not** auto-run setup with `--apply`. Operators run setup explicitly after reviewing dry-run output.

---

## 9. Risks

| Risk | Severity | Mitigation | Label |
|---|---|---|---|
| Silent overwrite of team `CLAUDE.md` | High | Default `--dry-run`; prefer `CLAUDE.local.md`; marker-only edits | Design constraint |
| Operator declines Claude external-import approval | High | Doctor warning + manual docs; suggest `@~/.claude/...` pattern from Anthropic docs | VERIFIED dialog exists; AMP reset UNKNOWN |
| Import paths wrong when target is `.claude/CLAUDE.md` | Medium | `--target` resolves relative paths from containing file | VERIFIED relative resolution |
| Marker block edited by user then overwritten by re-run | Low | Markers documented as AMP-managed; only inner import lines change | — |
| Projections exceed 2k token budget | Medium | Materialization enforces budget; doctor warns | spec §4.2.3 |
| Confusion with `amp propagate` (from-amp skills/rules) | Medium | Separate command group `amp projection` vs adapter propagation | — |
| `CLAUDE.md` gitignored (common) vs team-shared `.claude/CLAUDE.md` | Medium | `--target auto` prefers local; document team workflow via publish | PROVISIONAL team policy |
| Stale published snippet vs live projections | Low | Publish labeled frozen; not default path | — |

---

## 10. Implementation phasing (reference)

| Phase | Deliverable |
|---|---|
| v1.5b-a | `amp projection setup claude-code` (dry-run + apply + markers) |
| v1.5b-b | Doctor import wiring checks |
| v1.5b-c | Projection materialization refresh pipeline |
| Optional | `amp publish projection-imports --harness claude-code --to <path>` |

This task delivers **design only** — no code changes to CLI.

---

## 11. Verification plan (for implementer)

| Test | Expected |
|---|---|
| `amp projection setup claude-code --dry-run` on repo with existing `CLAUDE.md` | No file mutation; plan shows marker append |
| `--apply --target claude.local` | Creates/updates only marker block; `git status` unchanged for `.amp/local/` |
| Re-run `--apply` | Idempotent — no duplicate markers |
| `amp doctor` after setup | Import wiring ok |
| `npm run amp:acceptance` | Unchanged pass (no new live requirements) |

---

## 12. Ready for Codex evaluation

**Yes** — decision is explicit, command UX is specified, Anthropic claims are labeled, Invariant 6 is preserved, and materialization is explicitly out of scope.
