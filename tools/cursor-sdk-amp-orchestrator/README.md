# Cursor SDK AMP Orchestrator

Programmatic Composer 2.5 harness for AMP implementation support.

This is not the AMP runtime. It is an orchestration tool used by the human/Codex orchestrator to ask Cursor Composer 2.5 for bounded implementation plans, code sketches, reviews, and Ralph-loop task breakdowns.

## Setup

```bash
cd tools/cursor-sdk-amp-orchestrator
export CURSOR_API_KEY=...
uv sync
```

## Usage

Run a single Composer task:

```bash
uv run python main.py task manifests/vertical-slice-architect.json
```

Run all manifest tasks and write reports:

```bash
uv run python main.py run-all manifests/amp-vertical-slice.json --out reports
```

## Direct Cursor Composer Fallback

If `CURSOR_API_KEY` is unavailable but Cursor is open and signed in:

```bash
pbcopy < tools/cursor-sdk-amp-orchestrator/direct-composer-prompt.md
```

Then in Cursor:

1. Open the `ai-memory` workspace.
2. Open Composer.
3. Paste and submit the prompt.
4. Composer should write:
   `tools/cursor-sdk-amp-orchestrator/reports/direct-composer-vertical-slice.md`

This keeps Composer's work bounded and verifiable through the filesystem.

## Rules

- Model is pinned to `composer-2.5`.
- Runtime is local with cwd set to the `ai-memory` repo root.
- Each child task has one role and one output contract.
- Composer output is advisory until the orchestrator applies or rejects it.
- No child task may request secrets or mutate user-authored harness files.
- Ralph-loop output must be atomic tasks that fit one commit each.
