# Grok CLI

Grok CLI has no adapter of its own. It runs Claude settings hooks natively, so `../claude-code` captures
Grok sessions (logged as host `grok`). Use the Claude Code install: project
`.claude/settings.json` (needs folder trust: `--trust` or `/hooks-trust`) or `~/.claude/settings.json`.
Flat Cursor entries (`../cursor/hooks.json`) do not run in Grok: it runs only matcher groups.

Injection: Grok reads only `systemMessage` from SessionStart, which reaches the user and not the model. The
index goes in as a project rule instead:

```sh
node node_modules/@radix-ai/ai-memory/adapters/grok/sync-index.mjs   # writes .grok/rules/ai-memory-index.md
```

After that, each Grok session start refreshes the file from `mem index` (through the Claude Code hook), so
the next session sees the current index. The hook never creates the file. For every project at once, write
the same text to `~/.grok/rules/ai-memory-index.md` yourself; rules there apply to all projects, whichever
memory they belong to. Keep the project file out of git if the index is private.

Limits (Grok CLI 1.0.77): the index is one session stale unless synced before launch; SessionStart and
UserPromptSubmit fire concurrently, so the prompt can be logged before session_start.
