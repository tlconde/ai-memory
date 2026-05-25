# AMP Cursor Projection Import Spike (AMP-PROJ-01)

> **Date:** 2026-05-25
> **Environment:** macOS, repo `/Users/dev/Dev/Github/ai-memory`, worktree at commit `43595df513b08568022f1864f2f4412c2966d941`
> **Scope:** Verify Cursor MDC `@filename` import semantics for AMP v1.5 filesystem projection loading. No projection materialization, no `.cursor/` edits, no acceptance-gate changes.

## Decision

**Do not ship Claude-style recursive `@path` projection imports for Cursor in v1.5b.**

For Cursor, AMP **inlines regenerated projection content into emitted `.cursor/rules/from-amp/*.mdc` artifacts** (or serves projections via MCP Tier 2). Live load of the flattened rule is **VERIFIED** when the temp project is the workspace root.

Cursor **recursive `@` import chains** inside projection paths remain **UNKNOWN / not used** — do not rely on nested `@` expansion until a separate live protocol confirms behavior. Single-level `@` injection for plain `.md` files outside `.cursor/rules/` was spike scope only; Wave 16 chose flattened emit instead.

## Commands

### Worktree / branch setup

```bash
export WORKTREE_START_REF='43595df513b08568022f1864f2f4412c2966d941'
# worktree created at ~/.cursor/worktrees/amp-proj-01-63dbe387/ai-memory-6990700b6035
git -C "$WORKTREE_PATH" checkout -b ralph/amp-proj-01-cursor-import-spike
git -C "$WORKTREE_PATH" rev-parse HEAD
# 43595df513b08568022f1864f2f4412c2966d941
```

### Docs fetch (external)

```bash
# Cursor rules docs — fetched 2026-05-25
curl -sL 'https://cursor.com/docs/context/rules' | rg -n '@filename|reference other|include files' | head
```

### Repo inspection (local)

```bash
rg -n 'Cursor parity|@filename|recursive projection' docs/specs/AMP_CONSOLIDATED_SPEC.md
rg -n '@.*\.(md|mdc)' .cursor/rules/ || true   # run from repo root; .cursor may be gitignored
ls tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/
```

### Fixture layout (committed evidence)

```bash
$ find tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike -type f | sort
tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/live-test-protocol.md
tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/projection-chain-a.md
tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/projection-chain-b.md
tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/projection-leaf.md
```

Live Cursor rule activation was **not** run in this task (`.cursor/` is out of scope). See `fixtures/cursor-import-spike/live-test-protocol.md` for the follow-up procedure.

## Observations

### 1. AMP spec assumes Claude resolver; flags Cursor as unverified

From `docs/specs/AMP_CONSOLIDATED_SPEC.md` §4.2.2:

- Claude Code: `@path/to/import` with relative/absolute paths, recursive up to **5 hops** — marked **VERIFIED** (Anthropic docs).
- Cursor: `@filename` / MDC import behavior — **not locked**; spike required before recursive projection loading.

Proposed Cursor/global setup in spec (not verified for Cursor):

```markdown
@~/.amp/projection/global.md
@~/.amp/runtime/global.md
@.amp/local/projection.md
@.amp/local/runtime.md
```

**Label:** VERIFIED (spec text) — Cursor parity explicitly deferred.

### 2. Official Cursor docs: `@filename` includes file content (one level)

Source: [Cursor Rules docs](https://cursor.com/docs/context/rules) (fetched 2026-05-25).

FAQ — *Can rules reference other rules or files?*

> Yes. Use `@filename.ts` to include files in your rule's context. You can also @mention rules in chat to apply them manually.

Examples in the same page use inline references such as `@migration-template.sql`, `@express-service-template.ts`, and `@component-template.tsx` inside rule bodies. Best-practices guidance says:

> Reference files instead of copying their contents—this keeps rules short and prevents them from becoming stale as code changes.

**Label:** VERIFIED (external docs) — Cursor rule `@filename` is **content injection into rule context**, not a bare hyperlink or metadata-only mention.

**Label:** UNKNOWN (external docs) — Docs do **not** state whether `@` tokens inside an injected file are recursively expanded. No hop limit is documented (contrast Claude Code's explicit 5-hop cap).

### 3. Claude Code contrast (verified recursive semantics)

Source: [Anthropic Claude Code memory docs](https://docs.anthropic.com/en/docs/claude-code/memory) (fetched 2026-05-25).

> CLAUDE.md files can import additional files using `@path/to/import` syntax. Imported files are expanded and loaded into context at launch … Imported files can recursively import other files, with a maximum depth of five hops.

**Label:** VERIFIED (external docs) — Claude `@path` = expand + recurse (≤5 hops). This is the behavior AMP spec §4.2.2 plans to reuse for Claude Code only.

### 4. Cursor forum: nested `@` / non-`.mdc` references are unreliable

Source: [Cursor forum — Project rules can not access mentioned files](https://forum.cursor.com/t/project-rules-can-not-access-mentioned-files/50085) (Feb 2025).

- User linked `.txt` docs from an `.mdc` rule via `mdc:` markdown links; Composer reported referenced content **not available**.
- User workaround: referenced files must also be `.mdc` (still flaky when many large rules co-loaded).
- Cursor staff (Dan): hyphen handling issues; v0.46+ UI shows which rules are active per prompt.

**Label:** PROVISIONAL (community + staff reply) — Indirect references inside rules may fail to inject content; plain non-rule files under `.cursor/rules/` are especially unreliable. Does not definitively prove behavior for `@path/to/file.md` syntax outside `.cursor/rules/`.

### 5. This repo's existing Cursor rules do not use `@` file injection

Inspected at repo root (gitignored `.cursor/rules/`):

| Rule | Pattern | Implication |
|---|---|---|
| `00-load-ai-memory.mdc` | Prose: "Read `.ai/IDENTITY.md`" | Instructional path, not `@` injection |
| `01-publish-reminder.mdc` | Prose: "Canonical definition: `.ai/rules/publish-reminder.md`" | Same — agent told to read, not auto-inlined |

**Label:** VERIFIED (local observation) — Production rules in this workspace rely on **agent Read tool compliance**, not MDC `@` inclusion, for cross-file canonical content.

### 6. AMP Cursor emission path vs import-based projection

AMP spec §9.4 / §12.6:

- Cursor compiler emits `.cursor/rules/from-amp/SKILL_NAME.mdc` (flat `.mdc`, AMP-managed).
- v1.5 projection files live at `~/.amp/projection/global.md`, `<project>/.amp/local/projection.md`, etc.
- Bridging projections into Cursor context via `@.amp/...` inside an emitted `.mdc` would require Cursor to inject **non-rule markdown** from outside `.cursor/rules/`.

**Label:** PROVISIONAL — Docs examples inject project files (`.ts`, `.sql`, templates) but do not document `.amp/` paths, tilde expansion, or recursive markdown `@` chains.

### 7. Live experiment status

| Experiment | Result in AMP-PROJ-01 |
|---|---|
| Activate temp `.mdc` with `@fixtures/.../projection-leaf.md` | **Not run** — `.cursor/` edits forbidden for this task |
| Recursive `@` chain (chain-a → chain-b) | **Not run** — same constraint |
| `@~/.amp/...` absolute import | **Not run** |
| Cursor version / rules UI "in use" panel | **Not captured** |

Fixtures and protocol committed under `fixtures/cursor-import-spike/` for a follow-up live gate (recommended owner: AMP v1.5b Cursor adapter task).

## Findings summary

| Question | Verdict | Label |
|---|---|---|
| Does Cursor MDC `@filename` inject file content vs bare reference? | **Inject / include in rule context** | VERIFIED (Cursor docs) |
| Does Cursor recursively expand `@` inside injected markdown? | **Undocumented; not tested live here** | UNKNOWN |
| Is there a documented hop limit? | **None found** | UNKNOWN |
| Does `@~/.amp/...` work like Claude home paths? | **Undocumented; likely project-relative only in examples** | PROVISIONAL |
| Can plain `.md` outside `.cursor/rules/` be injected reliably? | **Docs say yes for `@filename`; forum reports failures for non-`.mdc` indirect refs** | PROVISIONAL |
| Is Claude 5-hop recursive import safe to assume for Cursor? | **No** | VERIFIED (negative inference from doc gap + spec flag) |

## Recommendation for downstream AMP work

| Track | Action |
|---|---|
| **v1.5b Cursor projection** | Emit **flattened** projection + runtime bodies inside `.cursor/rules/from-amp/amp-projection.mdc` (regenerated on consolidation). Avoid `@.amp/...` import chains — recursive `@` remains **UNKNOWN / not used**. Live flattened rule load: **VERIFIED**. |
| **Context budget** | Enforce AMP 2k-token cap at materialization time in the compiler, not via nested imports. |
| **Follow-up spike** | Run `fixtures/cursor-import-spike/live-test-protocol.md` in Cursor ≥0.46; record version, rules-in-use UI, and marker visibility. |
| **MCP fallback** | If live tests fail single-level injection for `.amp/` paths, prefer Tier 2 MCP reads over filesystem import chains. |

## Residual risks

1. **UNKNOWN recursion** — If Cursor does recurse, flattened emit duplicates content but remains safe; if it does not recurse, import-chain designs would silently drop nested projection segments.
2. **PROVISIONAL path semantics** — Tilde/home and out-of-tree `.amp/` paths may not resolve the same as Claude `@~/.amp/...`.
3. **Rule size / activation** — Forum reports of degraded model behavior when many large rules load at once; flattening four projection files into one `.mdc` needs token budget enforcement (spec §4.2.3).
4. **Version drift** — Cursor v0.46+ rules UI changed; behavior may differ across Cursor versions without pinned live verification.

## External claims index

| Claim | Label |
|---|---|
| Cursor `@filename` includes files in rule context | VERIFIED — [cursor.com/docs/context/rules](https://cursor.com/docs/context/rules) |
| Claude `@path` recurses ≤5 hops | VERIFIED — [docs.anthropic.com/claude-code/memory](https://docs.anthropic.com/en/docs/claude-code/memory) |
| Non-`.mdc` nested rule references fail to inject | PROVISIONAL — [forum.cursor.com/t/project-rules-can-not-access-mentioned-files/50085](https://forum.cursor.com/t/project-rules-can-not-access-mentioned-files/50085) |
| Cursor recursive `@` import in markdown | UNKNOWN — no official source; live test not run |
| `@~/.amp/...` works in Cursor rules | UNKNOWN / PROVISIONAL |
