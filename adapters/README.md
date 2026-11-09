# Host adapters

Each adapter pipes LogEvent lines to `mem log` and injects `mem index` (INDEX.md) at session start.
`_shared/emit.mjs` holds the common part: running `mem` (`MEM_BIN`, default `mem`) with a 1 s timeout,
filename-safe session ids, 8,000-character truncation, dedupe markers, and always exiting 0.

| Host | Adapter | Capture | Injection |
|---|---|---|---|
| Claude Code | `claude-code` | Full: prompts, tool calls, results, failures, final reply | SessionStart `additionalContext` |
| Codex CLI | `codex` | Full except failures, which arrive as tool results, and hosted tools | SessionStart `additionalContext` |
| Cursor IDE and cursor-agent | `cursor` | Full; under `-p` the prompt and reply come from the transcript at sessionEnd | sessionStart `additional_context` |
| Gemini CLI | `gemini` | Full | SessionStart `additionalContext` (JSON-only stdout) |
| Antigravity (`agy`, IDE) | `antigravity` | Full; tool output and replies come from the transcript at Stop | First PreInvocation `injectSteps` ephemeral message |
| Grok CLI | `claude-code` (native Claude settings) | Full | Rule file `.grok/rules/ai-memory-index.md` (`grok/sync-index.mjs`) |
| Hermes, OpenClaw | `hermes`, `openclaw` (built separately) | See their READMEs | See their READMEs |
| T3 Code | none | Runs Claude, Codex and Grok sessions with their normal hook loading, so those adapters apply | Same as the provider |
| Grok Bot.app (0.79.3, `com.anysphere.sand`) | none: not supported | Anysphere-built; its app bundle has no local `hooks.json` or Claude settings loader | None |
| Anything else | `generic/mem-wrap` | Command line, stdout and stderr tails, exit status | `mem-wrap --index` prints INDEX.md |

Grok sessions (run through the Claude Code adapter) log as host `grok`, and Antigravity as `antigravity`.

Adapter state (dedupe markers, Antigravity transcript cursors) lives in `.memory/log/.adapters/`, which is
gitignored with the log and never read by the store. Tests replay recorded host payloads
(`*/fixtures/`) against `_shared/fixtures/fake-mem.mjs`.
