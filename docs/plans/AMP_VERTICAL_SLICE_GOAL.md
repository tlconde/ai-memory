# AMP Vertical Slice Goal

> **Use this as the starting goal for the new `ai-memory` implementation branch.**

## Branch

Create a new branch from the current implementation base:

```bash
git switch -c ralph/amp-vertical-slice
```

Do not include unrelated benchmark or workspace changes in the AMP commit.

## Goal

Build the smallest falsifiable AMP vertical slice:

> A scoped preference created from one local harness is captured as an AMP frame, queued in runtime, consolidated into the knowledge store, retrieved by another local harness, and protected by scope and `from-amp` invariants.

This is the first proof that the substrate abstraction earns its complexity.

## Source Documents

Read these in order:

1. `docs/specs/AMP_CONSOLIDATED_SPEC.md`
2. `docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md`
3. `docs/architecture/AMP_ARCHITECTURE.html`
4. `docs/plans/AMP_VERTICAL_SLICE_DECISIONS.md`
5. `docs/plans/AMP_RALPH_TASKS.md`

Treat the spec as the contract, the guide as implementation routing, and the HTML as the architecture briefing.

## Orchestration Model

The human/Codex session is the orchestrator. Cursor Composer 2.5 and Ralph loops are power tools with bounded responsibilities:

- **Codex/orchestrator** owns synthesis, final implementation decisions, file edits, and verification.
- **Cursor Composer 2.5** reviews architecture slices, proposes module boundaries, and pressure-tests adapter contracts through `tools/cursor-sdk-amp-orchestrator/`.
- **Ralph loop** executes atomic implementation tasks only after the vertical-slice task list is clean and scoped to one commit per task.

Composer output is advisory until the orchestrator accepts it. Ralph output must pass tests and conformance checks before the next loop.

## Composer 2.5 Harness

Setup:

```bash
cd tools/cursor-sdk-amp-orchestrator
export CURSOR_API_KEY=...
uv sync
```

Run all bounded Composer tasks:

```bash
uv run python main.py run-all manifests/amp-vertical-slice.json --out reports
```

Use Composer for:

- vertical-slice module boundary review
- adapter contract adversarial review
- Ralph-compatible task slicing

Do not use Composer for deterministic checks that scripts can run directly.

## Ralph Loop Handoff

Use Ralph only after the Composer reports have been reviewed and the AMP task list is atomic.

Preflight:

```bash
git switch -c ralph/amp-vertical-slice
git config core.hooksPath .githooks
bash /Users/dev/Dev/Github/ctc-ralph/skills/validate-specs/validate.sh
```

If the current root `specs/` still belong to another workstream, do not overwrite them in-place. Create a clean worktree or move the AMP vertical-slice spec/task set into root `specs/` only on the Ralph branch.

Current locked decisions live in `docs/plans/AMP_VERTICAL_SLICE_DECISIONS.md`. Ralph-compatible tasks live in `docs/plans/AMP_RALPH_TASKS.md`.

## Initial Scope

Implement only:

- Frame schema with conformance IDs for the five invariants
- Configurable SQLite runtime store
- Minimal knowledge store adapter sufficient for the vertical slice
- Capability coverage parser
- JSON-RPC error envelope
- Cursor filesystem adapter skeleton
- Claude Code filesystem adapter skeleton
- Path-safety guard proving writes stay inside `from-amp`
- One end-to-end test from Cursor-style input to Claude Code-style retrieval

Do not implement:

- Remote MCP gateway
- ChatGPT/Claude.ai cloud memory writes
- Codex/Gemini/Windsurf adapters
- Multi-device sync
- Multi-store federation
- Model fine-tuning
- Full procedural lifecycle beyond compile/emit/conflict-flag

## Required Design Decisions

- Runtime path must be configurable. Defaults:
  - Linux: `$XDG_DATA_HOME/amp/runtime.db`, falling back to `~/.local/share/amp/runtime.db`
  - macOS: `~/Library/Application Support/amp/runtime.db`
  - Tests: isolated temporary path only
- Procedure propagation uses a compiler model:
  - canonical AMP artifact is the source of truth
  - Cursor `.mdc` and Claude Code `SKILL.md` are emitted artifacts
  - emitted artifacts live only under `from-amp`
- v1 adapter scope is verified-only:
  - Cursor and Claude Code first
  - no Codex/Gemini/Windsurf adapter unless placement and load behavior are directly tested

## Acceptance Tests

The branch is ready for review only when these pass:

- A valid frame round-trips with `kind`, `scope`, `curation_mode`, provenance, and schema version preserved.
- A project-scoped fact cannot be promoted to user scope without explicit confirmation.
- Runtime-internal state is not written to the knowledge graph and never receives `curation_mode`.
- The Cursor adapter refuses any write path resolving outside `.cursor/rules/from-amp/`.
- The Claude Code adapter refuses any write path resolving outside the selected `from-amp/` skill root.
- Capability coverage accurately reports unsupported features instead of silently pretending support.
- End-to-end: Cursor-style scoped preference -> runtime queue -> consolidation -> knowledge store -> Claude Code retrieval.

## Kill Criterion

If this vertical slice is not working after two focused implementation weeks, pause and reassess. The substrate abstraction may be too broad, too early, or missing a simpler proof path.

## Starter Prompt

```text
Implement the AMP vertical slice in the ai-memory repo on branch `ralph/amp-vertical-slice`.

Read:
- docs/specs/AMP_CONSOLIDATED_SPEC.md
- docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md
- docs/plans/AMP_VERTICAL_SLICE_GOAL.md
- docs/plans/AMP_VERTICAL_SLICE_DECISIONS.md
- docs/plans/AMP_RALPH_TASKS.md
- tools/cursor-sdk-amp-orchestrator/README.md

Build only the initial vertical slice: schema, configurable runtime store, minimal knowledge store, capability coverage, JSON-RPC errors, Cursor and Claude Code filesystem adapter skeletons, path-safety guards, and one end-to-end test proving Cursor-style scoped preference capture can be consolidated and retrieved through Claude Code-style access.

Do not implement remote MCP, cloud surfaces, Codex/Gemini/Windsurf adapters, multi-device sync, multi-store federation, or model fine-tuning.

Every behavior claim needs a falsifiable test. Preserve the `from-amp` invariant and never touch user-authored harness files.

Use Cursor Composer 2.5 through `tools/cursor-sdk-amp-orchestrator` for bounded architecture review and Ralph task slicing. Treat Composer output as advisory. Use Ralph loops only for atomic, test-backed tasks.
```
