# Docs

Architecture documentation and implementation plan.

## Reference

- [`reference/`](reference/) — AI coding tools reference: summaries, URLs for web fetch, adapter assumptions, native integration strategy.
- [`reference/TOOLS_INDEX.md`](reference/TOOLS_INDEX.md) — Master index of all tools (Cursor, Claude Code, Windsurf, Cline, Antigravity, Codex, Warp, VS Code Copilot, Zed, Replit, Bolt.new, GitHub Copilot, Lovable).
- [`reference/TOOL_NATIVE_DESIGN.md`](reference/TOOL_NATIVE_DESIGN.md) — Design principle: use each tool's native plugin/MCP/skills/agents/hooks; do not reinvent.
- [`reference/CONTEXT7_RULE.md`](reference/CONTEXT7_RULE.md) — **Mandatory:** Always use Context7 when fetching or updating tool documentation (2026/2025).

Run `node scripts/update-tool-refs.mjs` to refresh "Last verified" dates. Use `--check-llms` to verify llms.txt URLs.

## Plans

- [`plans/MASTER_PLAN.md`](plans/MASTER_PLAN.md) — Single consolidated plan: purpose, naming, tier structure, all components, MCP API, CLI, plugin distribution, evals, implementation sequence.

## Specs

- [`specs/MCP_API_SPEC.md`](specs/MCP_API_SPEC.md) — MCP server resources and tools reference.

## Guides

- [`TOOL_ONBOARDING.md`](TOOL_ONBOARDING.md) — How to connect ai-memory to any AI tool (Claude Code, Cursor, Windsurf, Cline, Copilot, or anything else).
