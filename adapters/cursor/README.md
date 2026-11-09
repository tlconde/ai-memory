# Cursor adapter (IDE and cursor-agent)

`hook.mjs` takes Cursor's flat `hooks.json` entries. Mapping: sessionStart/sessionEnd, beforeSubmitPrompt
(user), preToolUse (tool_call), postToolUse (tool_result: `tool_output` parsed), postToolUseFailure
(error: `error_message`), afterAgentResponse (assistant). sessionStart prints
`{"additional_context": INDEX.md}` (reliable in cursor-agent; best effort in the IDE, where it can race).

cursor-agent `-p` (checked on 2026.10.22 and 2026.11.05) never fires beforeSubmitPrompt, afterAgentResponse
or stop: the server does not request them. So at sessionEnd the adapter reads `transcript_path` and logs
each prompt and each turn's last reply, unless prompts already arrived live. They then follow the tool events.

Install (Node 22+, `mem` on PATH or `MEM_BIN`):
- Project: copy `hooks.json` to `.cursor/hooks.json` (project hooks run in the workspace root).
- User: merge it into `~/.cursor/hooks.json`, with the command's path made absolute (user hooks run in `~/.cursor`).

Registering in both `.cursor/hooks.json` and Claude settings is safe: duplicates are dropped (see
`../claude-code`). Grok CLI does not run flat Cursor entries, so this file does nothing there.

Limits: tool output stays only in the log (Cursor's transcript keeps calls, not results); text between tool
calls (afterAgentThought) is not logged.
