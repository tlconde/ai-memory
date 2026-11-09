# MCP server

`mem mcp` runs an MCP server on stdio with exactly two tools:

- `search {query, limit?, layers?}`: hits from the log, notes, wiki and past findings, each with
  `layer`, `source`, `snippet` and, for notes and past findings, `verified`.
- `note {about, fact, evidence?}`: stores one fact and returns its `id`. Evidence refs are
  `<session>:<first>-<last>` (or a log hit's `source`) and must exist in the log. Without evidence
  the note is stored as a hypothesis and the reply carries a `warning`. The same fact about the same
  entity is merged into the existing note.

The memory root is `--root`, else `$MEM_ROOT`, else `./.memory` in the server's working directory.
Needs Node 22+ and `mem` on PATH.

Claude Code, project `.mcp.json` (the plugin in `claude-code/` already declares this server, so skip
this if you installed the plugin):

```json
{
  "mcpServers": {
    "ai-memory": { "command": "mem", "args": ["mcp"] }
  }
}
```

Cursor, `.cursor/mcp.json` (Cursor does not promise the workspace as the working directory, so pass the root):

```json
{
  "mcpServers": {
    "ai-memory": { "command": "mem", "args": ["mcp", "--root", "${workspaceFolder}/.memory"] }
  }
}
```
