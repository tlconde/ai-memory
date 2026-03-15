---
id: memory-patterns
type: pattern
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Patterns

**Format:** Tag each entry `[P0]`, `[P1]`, or `[P2]`. Include pattern and anti-pattern.
Optional: `**Links to:**` for related entries.

---

### [P1] Security: validate-then-resolve for paths

**Pattern:** Always call `decodeURIComponent()` BEFORE path traversal checks, then `resolve()`, then `relative()` check.
**Anti-pattern:** Resolving first, checking second — encoded `%2e%2e` bypasses `startsWith()`.
**Links to:** assertPathWithinAiDir in tools.ts

### [P1] Adapter pattern for multi-tool support

**Pattern:** One `TOOL_ADAPTERS` map with `{ dest, content, mcp, extraFiles }` per tool. CLI iterates and writes. Skills go to `.agents/skills/` (portable).
**Anti-pattern:** Separate adapter directories per tool with duplicated bootstrap text.
**Links to:** src/cli/adapters.ts

### [P2] Eval-driven development

**Pattern:** Add evals for every new capability (platform integration, cloud readiness, automation readiness). Run `ai-memory eval` to measure adoption.
**Anti-pattern:** Shipping features without measurable success criteria.
