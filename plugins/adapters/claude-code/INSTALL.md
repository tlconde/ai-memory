# Claude Code — Post-install steps

Hooks installed: SessionStart (context injection), PreCompact (state preservation).
Restart Claude Code for hooks to take effect.

1. Enable the ai-memory MCP server in your tool's settings (it's disabled by default).
2. Start a new session and verify with: "What does .ai/IDENTITY.md say about this project?"

For capability-specific setup (browser, desktop_automation), see `.ai/reference/capability-specs.json` or run `ai-memory install --capability <name>`.
