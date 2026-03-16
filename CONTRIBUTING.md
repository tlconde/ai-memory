# Contributing to ai-memory

Thanks for your interest in contributing!

## Quick start

```bash
git clone https://github.com/radix-ai/ai-memory.git
cd ai-memory
npm install
npm run build
```

## Development

```bash
npm run dev          # Watch mode (tsc --watch)
npm run typecheck    # Type check without emitting
npm run build        # Full build
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run typecheck` to ensure no type errors
4. Commit with a clear message
5. Open a PR against `main`

## What to contribute

- **Bug fixes**: Always welcome
- **New tool adapters**: Add support for more AI coding tools
- **Skills**: New skills in `plugins/ai-memory/skills/`
- **Evals**: New eval metrics in `src/evals/`
- **Documentation**: Improvements to README, adapter docs, or reference files

## Architecture

- `src/cli/` — CLI commands (`ai-memory init`, `install`, `mcp`, etc.)
- `src/mcp-server/` — MCP server (tools, resources, governance)
- `src/evals/` — Eval metrics
- `src/formatter/` — YAML frontmatter validation
- `plugins/ai-memory/` — Plugin skills, agents, rules
- `plugins/adapters/` — Tool-specific adapters (Claude Code hooks, etc.)
- `templates/` — Scaffolding templates for `ai-memory init`

## Code style

- TypeScript, strict mode
- ES modules (`"type": "module"`)
- No unnecessary abstractions
- Prefer editing existing files over creating new ones
