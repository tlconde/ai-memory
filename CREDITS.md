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
| Hermes Agent (Nous Research) | https://github.com/NousResearch/hermes-agent | MIT, per the LICENSE file of the installed checkout (v0.20.0), checked 2026-11-09; no text or code copied | Dependency: `adapters/hermes` implements Hermes' `MemoryProvider` plugin interface and loader contract (`plugin.yaml`, `register(ctx)`, `memory.provider`); its tests import Hermes' base class and loader read-only when installed. |
| OpenClaw | https://github.com/openclaw/openclaw | MIT, per the LICENSE file and package.json of the installed package (2026.7.1-2), checked 2026-11-09; no text or code copied | Dependency: `adapters/openclaw` implements OpenClaw's plugin manifest, entry and typed-hook contract (`openclaw.plugin.json`, `api.on`, hook payload shapes from `dist/hook-types-*.d.ts`). |
