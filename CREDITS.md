# Credits

Credits state what this project took from others. They do not imply endorsement, partnership or review by anyone listed.

| Source | Link | License (checked 2026-11-09) | What we took |
|---|---|---|---|
| Anthropic, "Components of agent memory" | https://www.anthropic.com/research/components-of-agent-memory | Article, all rights reserved by Anthropic; no text or code copied | Idea: the four memory layers (transcript log, notes, consolidated wiki, injected context), offline dreaming that tests notes against transcripts, one page per entity, and letting strong models judge salience instead of fixed rules. SPEC.md quotes short passages with attribution. |
| Model Context Protocol TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk | MIT | Dependency: the MCP server for the `search` and `note` tools. |
| Node.js `node:sqlite` (bundled SQLite with FTS5) | https://nodejs.org/api/sqlite.html | MIT (Node.js); SQLite is public domain | Dependency: full-text search over all layers. |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 | Dev dependency: compiler. |
| tsx | https://github.com/privatenumber/tsx | MIT | Dev dependency: runs tests. |
| Claude Code hooks and plugins (Anthropic) | https://code.claude.com/docs/en/hooks | Proprietary: "© Anthropic PBC. All rights reserved", per https://github.com/anthropics/claude-code/blob/main/LICENSE.md; no text or code copied | Dependency: `adapters/claude-code` implements Claude Code's documented hook input and output contract and plugin layout. |
