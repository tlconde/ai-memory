# Codex adapter

Codex sends Claude-shaped payloads, so `hook.mjs` is the Claude Code mapping with host `codex`:
SessionStart/SessionEnd, UserPromptSubmit (user), PreToolUse (tool_call), PostToolUse (tool_result),
Stop (assistant: `last_assistant_message`). SessionStart prints
`{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": INDEX.md}}`
(Codex spills context over about 2,500 tokens to a file).

Install (Node 22+, `mem` on PATH or `MEM_BIN`):
- Project: copy `hooks.json` to `.codex/hooks.json`. Codex loads it only in a trusted project.
- User: merge it into `~/.codex/hooks.json`, with the command's path made absolute.
- Each hook must then be trusted once by hash: `/hooks` in the TUI. Non-interactively, `codex exec` accepts
  `-c 'hooks.state={"<key>"={trusted_hash="sha256:…"}}'`, with key and hash from the app-server
  `hooks/list` call. Use an inline table: the dotted `-c` key splits at the `.` in `.codex/hooks.json`.

Limits (Codex CLI 0.166.0): there is no failure event, so a failed command is a tool_result whose text is
its output; hosted tools such as web search fire no PostToolUse; only the final text of a turn is logged.
