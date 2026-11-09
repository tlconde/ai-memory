# Claude Code adapter (also cursor-agent and Grok CLI)

`hook.mjs` maps each hook to LogEvents for `mem log` and injects `mem index` at SessionStart as
`hookSpecificOutput.additionalContext`. It always exits 0. Hooks: SessionStart/SessionEnd, UserPromptSubmit
(user), PreToolUse (tool_call, `refs` = file path), PostToolUse (tool_result), PostToolUseFailure and
PermissionDenied (error), Stop (assistant: `last_assistant_message`).

The same settings run in two other hosts, detected from the payload:
- cursor-agent (`cursor_version`): handed to `../cursor`, logged as `cursor`. Registered there too, each
  payload fires twice, byte-identical; the payload is the dedupe key (an O_EXCL marker under `log/.adapters`).
- Grok CLI (`GROK_*` env, camelCase fields): logged as `claude-code` with `refs: ["host:grok"]`. Grok ignores
  SessionStart context; see `../grok` for its index.

Install (Node 22+, `mem` on PATH or `MEM_BIN`):
- Plugin: `claude --plugin-dir node_modules/@radix-ai/ai-memory/adapters/claude-code` (uses `hooks/hooks.json`).
- Project: merge `settings.json` into `.claude/settings.json`. User: merge it into `~/.claude/settings.json`
  with `"$CLAUDE_PROJECT_DIR"/node_modules/...` replaced by the package's absolute path.

Every group has a `matcher` and every command is one string, because cursor-agent drops Claude groups
without a matcher and ignores `args`.

Limits (Claude Code 2.1.319): PreCompact is not hooked (SessionStart re-fires with `compact`); only the
final text of a turn is logged; a call refused at a permission prompt logs its tool_call but no outcome.
In cursor-agent, Claude settings cannot carry failures or replies (Cursor maps no Claude event to them), so
`.cursor/hooks.json` is the complete path there.
