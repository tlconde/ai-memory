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

- **Path traversal**: All file operations in the MCP server validate paths stay within `.ai/`
- **Immutability**: IDENTITY.md is immutable by default; structural paths (`toolbox/`, `acp/`, `rules/`) are always immutable
- **Claim locking**: Advisory file locks prevent concurrent write corruption
- **No secrets in memory**: Never store API keys, tokens, or credentials in `.ai/` files
