# Hermes adapter

A Hermes `memory_provider` plugin (pure stdlib Python) that takes the slot `gbrain_working_memory` holds today. At agent start it injects `mem index` into the system prompt; after each turn it logs the user message, assistant replies and every tool call and result to `mem log`, plus `session_start` and `session_end`.

Install (the plugin directory name must be `ai_memory`):

```sh
ln -s "$PWD/adapters/hermes/ai_memory" ~/.hermes/plugins/ai_memory
```

Enable it with one line in `~/.hermes/config.yaml`, under `memory:` (only one external provider runs at a time):

```yaml
  provider: ai_memory        # was: gbrain_working_memory
```

Restart Hermes (`hermes gateway restart` for the gateway). `mem` runs in `TERMINAL_CWD` (else the Hermes working directory); set `MEM_ROOT` in `~/.hermes/.env` to pin the memory root, and `MEM_BIN` if `mem` is not on `PATH`. Each `mem` call has a 2 s timeout, and failures go only to the Hermes log.

Rollback: set `provider: gbrain_working_memory` again and restart. The gbrain plugin is left untouched, so nothing else changes.

Why not plugin hooks: Hermes loads memory providers on their own path and gives them a context whose `register_hook` does nothing, so hooks would need a second plugin, a `plugins.enabled` entry and deduplication. `sync_turn` already receives the full OpenAI-style message list after each turn, including tool calls and results. The adapter keeps a per-session message cursor, so nothing is logged twice. A turn that is interrupted, which Hermes does not sync, is picked up by the next sync or at session end. History reloaded after a restart or `/resume` is not logged again. The cost is that tool events arrive at the end of the turn instead of as they happen.

Cron, flush and subagent contexts are not logged, as Hermes asks of providers. Tests: `python3 -m unittest discover -s adapters/hermes/tests`; they also run under `npm test`.
