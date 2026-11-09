# Claude Code adapter

`hook.mjs` is one Claude Code command hook. It turns each hook event into LogEvents for
`mem log` and, at session start, injects `mem index` (INDEX.md) as
`hookSpecificOutput.additionalContext`. It always exits 0; failures go to stderr.

| Hook | LogEvent |
|---|---|
| SessionStart / SessionEnd | `session_start` (source) / `session_end` (reason) |
| UserPromptSubmit | `user`: the prompt |
| PreToolUse | `tool_call`: compact JSON input, `refs` = file path |
| PostToolUse | `tool_result`: the response's string fields, joined |
| PostToolUseFailure, PermissionDenied | `error` |
| Stop | `assistant`: `last_assistant_message` |

Install either way (Node 22+, `mem` on PATH or set `MEM_BIN`; the root is
`$CLAUDE_PROJECT_DIR/.memory` unless `MEM_ROOT` is set):

- Plugin: `claude --plugin-dir node_modules/@radix-ai/ai-memory/adapters/claude-code`,
  or add this directory to a marketplace. It uses `hooks/hooks.json`.
- Project settings: merge `settings.json` here into `.claude/settings.json`.

Limits, checked against Claude Code 2.1.319:
- PreCompact is not hooked: SessionStart fires again with source `compact`, which marks the
  boundary and re-injects the index, and PreCompact stdout would become compaction instructions.
- Only the final assistant text of each turn is logged; text between tool calls is not.
- A call refused by a permission rule or prompt logs its `tool_call` but no outcome:
  no hook fires for it (PermissionDenied covers auto mode only).
