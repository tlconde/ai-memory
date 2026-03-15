# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ai-memory, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@radix-ai.com** (or open a private security advisory on GitHub).

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

This policy covers:
- The `@radix-ai/ai-memory` npm package
- The MCP server (`ai-memory mcp`)
- The CLI (`ai-memory`)
- Plugin manifests and skills

## Security Model

- **Path traversal**: All file operations validate paths stay within `.ai/` using `path.resolve` + `path.relative` checks. URI-encoded paths are decoded before validation.
- **Command injection**: Git operations in `sync_memory` use `execFileSync` (no shell) to prevent injection via commit messages.
- **Immutability**: IDENTITY.md is immutable by default; structural paths (`toolbox/`, `acp/`, `rules/`) are always immutable. Controlled via YAML frontmatter `writable` field.
- **Claim locking**: Advisory file locks prevent concurrent write corruption (5-minute TTL).
- **HTTP auth**: When `AI_MEMORY_AUTH_TOKEN` is set, the HTTP MCP server requires `Authorization: Bearer <token>` on all requests. Unset = no auth (local use only).
- **CORS**: Configurable via `AI_MEMORY_CORS_ORIGINS` (default: `*`). Restrict for production cloud deployments.
- **No secrets in memory**: Never store API keys, tokens, or credentials in `.ai/` files.

## Trust Boundaries

- **[P0] constraint patterns**: Authored by humans, compiled into `harness.json`. These include regex patterns applied to code diffs. Since they are human-authored and project-local, they are trusted input. Pathological regex patterns (ReDoS) are the author's responsibility.
- **Custom evals**: Loaded from `.ai/temp/custom-evals/` and executed with the same privileges as the MCP server. Only add custom evals from trusted sources. The `.ai/` directory should be treated as trusted project configuration.
- **MCP tool arguments**: All tool inputs are validated for type and bounds before use. Invalid inputs return `McpError` with descriptive messages.
