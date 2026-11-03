# Cursor — Post-install steps

1. Enable the ai-memory MCP server in Cursor settings (it's disabled by default).
2. Start a new session and verify with: "What does .ai/IDENTITY.md say about this project?"
3. Cursor hooks write `.ai/temp/import/latest-request.md` at session stop. Ask Cursor Agent to process that request when you want to reconcile Claude/Codex/Cursor memories into `.ai/memory/`.

Cursor public docs do not define a stable local chat transcript path. To import Cursor chats, export or place transcript files under `.ai/temp/import/cursor-chat-exports/`, or edit `.ai/import-sources.json` to point at a path you trust.

For capability-specific setup (browser, desktop_automation), see `.ai/reference/capability-specs.json` or run `ai-memory install --capability <name>`.
