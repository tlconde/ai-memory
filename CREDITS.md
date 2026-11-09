# Credits

Credits state what this project took from others. They do not imply endorsement, partnership or review by anyone listed.

| Source | Link | License (checked 2026-11-09) | What we took |
|---|---|---|---|
| Anthropic, "Components of agent memory" | https://www.anthropic.com/research/components-of-agent-memory | Article, all rights reserved by Anthropic; no text or code copied | Idea: the four memory layers (transcript log, notes, consolidated wiki, injected context), offline dreaming that tests notes against transcripts, one page per entity, and letting strong models judge salience instead of fixed rules. SPEC.md quotes short passages with attribution. |
| Model Context Protocol TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk | MIT | Dependency: the MCP server for the `search` and `note` tools. |
| Node.js `node:sqlite` (bundled SQLite with FTS5) | https://nodejs.org/api/sqlite.html | MIT (Node.js); SQLite is public domain | Dependency: full-text search over all layers. |
| ULID specification | https://github.com/ulid/spec | GPL-3.0 (repository license per the GitHub API, checked 2026-11-09); no text or code copied | Idea: the ULID format (48-bit millisecond time and 80 random bits in Crockford base32) and its same-millisecond monotonic increment, implemented from scratch in `src/store.ts` for note ids. |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 | Dev dependency: compiler. |
| tsx | https://github.com/privatenumber/tsx | MIT | Dev dependency: runs tests. |
| Claude Code hooks and plugins (Anthropic) | https://code.claude.com/docs/en/hooks | Proprietary: "© Anthropic PBC. All rights reserved", per https://github.com/anthropics/claude-code/blob/main/LICENSE.md; no text or code copied | Dependency: `adapters/claude-code` implements Claude Code's documented hook input and output contract and plugin layout. |
| OpenAI Codex CLI hooks | https://github.com/openai/codex | Apache-2.0 (GitHub API, checked 2026-11-09); no text or code copied | Dependency: `adapters/codex` implements Codex 0.166.0's hook input and output contract, read from its app-server schema and observed payloads. |
| Cursor hooks (Anysphere) | https://cursor.com | Proprietary; no license file in the cursor-agent 2026.11.05 runtime (checked 2026-11-09); no text or code copied | Dependency: `adapters/cursor` implements Cursor's `hooks.json` contract and its Claude-settings compatibility rules, observed in cursor-agent runs and its bundle. |
| Gemini CLI hooks (Google) | https://github.com/google-gemini/gemini-cli | Apache-2.0 (GitHub API and the installed package's LICENSE, checked 2026-11-09); no text or code copied | Dependency: `adapters/gemini` implements the documented hook contract of Gemini CLI 0.55.1. |
| Antigravity hooks (Google) | https://antigravity.google | Proprietary; no license file shipped with agy 1.1.12 (checked 2026-11-09); no text or code copied | Dependency: `adapters/antigravity` implements the `hooks.json` contract documented inside agy 1.1.12 and reads its transcript format. |
| Grok CLI hooks and rules (xAI) | https://x.ai | Apache-2.0, as stated by the README bundled with grok 1.0.77 (checked 2026-11-09); no public repository located; no text or code copied | Dependency: `adapters/claude-code` handles Grok's Claude-compatible hook payloads, and `adapters/grok` writes a Grok project rule file. |
