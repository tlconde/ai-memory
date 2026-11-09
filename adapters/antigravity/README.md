# Antigravity adapter

Antigravity hook payloads name no event, so `hooks.json` passes it as an argument. Mapping:
- PreInvocation: the conversation's first logs session_start and injects `{"injectSteps": [{"ephemeralMessage": INDEX.md}]}`
  (once per conversation, tracked in `.memory/log/.adapters/agy-<conversation>.json`); each turn's first
  (invocationNum 0) logs `lastUserInput` as user. `lastUserInput` is in the real payloads but not the docs.
- PreToolUse: tool_call (`toolCall.name`, `toolCall.args`). PostToolUse: error only if `error` is set.
- Stop: hooks carry no tool output or reply text, so Stop reads the steps of `transcriptPath` added since the
  last Stop: each PLANNER_RESPONSE text is assistant, and each output step after a tool call is its
  tool_result (error when "Command exited with code N" is non-zero). Checked against agy 1.1.12 transcripts.

Logged as host `gemini` (the closest adapter) with `refs: ["host:antigravity"]`; HostName has no `antigravity`.

Install (Node 22+, `mem` on PATH or `MEM_BIN`): copy `hooks.json` to `.agents/hooks.json`. Hooks run in the
directory holding hooks.json, which is why the command starts `../node_modules`. A user-level location is
not documented (possibly `~/.gemini/config/`, unverified), so use an absolute command path there.

Limits: there is no session end event; tool output and replies appear at Stop, after the turn's tool calls;
only run_command output steps were seen, so other tools' output step shapes are unverified.
