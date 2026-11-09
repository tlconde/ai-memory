# OpenClaw adapter

An in-process OpenClaw plugin in plain JavaScript ESM, so no build step is needed (OpenClaw 2026.7.1-2 loads `./index.js` directly). It logs each session to `mem log` and adds `mem index` to the system prompt.

| OpenClaw hook | LogEvent |
|---|---|
| `session_start` / `session_end` | `session_start` / `session_end` (the end event's text is the reason) |
| `before_prompt_build` | `user` (the run's prompt, once per run id; heartbeat runs are skipped); returns `prependSystemContext` with `mem index`, which is read once per session and returned unchanged on every run so the prompt stays cacheable |
| `before_tool_call` / `after_tool_call` | `tool_call` (params, refs from `derivedPaths` or `path`) / `tool_result`, or `error` |
| `llm_output` | `assistant` (the joined `assistantTexts`) |

The plugin does not use `message_received` or `llm_input`. `message_received` fires only for channel messages, carries no session id and duplicates the prompt. `llm_input` fires on every model call and needs conversation access.

Enable it in `~/.openclaw/openclaw.json` (shown as one object; merge it into your existing `plugins` block and keep your current `allow` entries):

```json5
plugins: {
  allow: [/* existing ids */ "ai-memory"],
  load: { paths: ["/path/to/ai-memory/adapters/openclaw/ai-memory"] },
  entries: { "ai-memory": { enabled: true, hooks: { allowConversationAccess: true }, config: { root: "/path/to/project/.memory" } } },
}
```

Then restart the Gateway. `allowConversationAccess` is needed only for `llm_output`; without it OpenClaw blocks that hook with a warning, and no assistant text is logged. `config.root` is optional: without it, `mem` uses `$MEM_ROOT`, else `.memory` in the Gateway's working directory. Set `MEM_BIN` if `mem` is not on the Gateway's `PATH`. `mem` is spawned asynchronously with a 2 s timeout, one `mem log` at a time, and no handler throws or blocks a tool.

Rollback: remove the `ai-memory` entries from `plugins.allow`, `plugins.load.paths` and `plugins.entries` (or set `enabled: false`), then restart. The memory slot (`plugins.slots.memory`) is not touched. Tests: `node --import tsx --test adapters/openclaw/openclaw.test.ts`.
