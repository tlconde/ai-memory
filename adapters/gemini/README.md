# Gemini CLI adapter

`hook.mjs` maps SessionStart/SessionEnd, BeforeAgent (user), BeforeTool (tool_call), AfterTool (tool_result
from `returnDisplay`, or error when `error` is set or `llmContent` reports a non-zero `Exit Code`) and
AfterAgent (assistant: `prompt_response`). SessionStart prints only
`{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": INDEX.md}}`, since Gemini
needs JSON-only stdout. Gemini prepends that context to the first prompt as `<hook_context>`; the adapter
strips it from the logged user text.

Install (Node 22+, `mem` on PATH or `MEM_BIN`):
- Project: merge `settings.json` into `.gemini/settings.json`. User: merge it into `~/.gemini/settings.json`
  with `"$GEMINI_PROJECT_DIR"/node_modules/...` replaced by the package's absolute path.

Trust (Gemini CLI 0.55.1): project settings load only in a trusted folder. Headless runs need
`GEMINI_CLI_TRUST_WORKSPACE=true`; `--skip-trust` passed the trust check but did not load project hooks
when tried. New project hooks print a warning, then run, and are recorded as trusted for that project.

Limits: model chunks (AfterModel) are not logged, only the final response per turn.
