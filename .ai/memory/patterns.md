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

<!-- session:s-compound-20260315 at:2026-03-15 -->
### [P1] Backend reporting for search

**Pattern:** Expose which backend served the search (Hybrid Native, Hybrid WASM, Keyword-only) in tool output. Improves observability and debugging when semantic model fails or falls back.

**Anti-pattern:** Silent fallback to keyword with no indication—user can't tell why recall dropped.

### [P1] Pre-warm embedding model at init

**Pattern:** Offer `init --download-model` to fetch the ~23MB hybrid search model during setup. First search is then fast; no surprise latency.

**Anti-pattern:** Lazy-load only—first query pays full download cost.

<!-- session:s-bootstrap-cleanup at:2026-03-15T21:00:00Z -->

### [P1] Canonical + stub pattern for cross-tool files

**Pattern:** Canonical content lives in `.ai/` (skills/, rules/, agents/). Tool directories (`.agents/skills/`, `.cursor/rules/`) get stubs that say "Read `.ai/skills/<name>/SKILL.md` for full instructions." Install command writes both canonical and stubs.

**Anti-pattern:** Writing full copies to tool directories. Content drifts between copies, different tools see different versions.

### [P1] Harness-as-policy: separate rule enforcement from reasoning

**Pattern:** Use code-based policy (harness rules, verify checks) for constraint enforcement. The LLM focuses on strategy; the harness handles validity. `verify` checks infrastructure, `validate_context` checks code, both run without LLM.

**Anti-pattern:** Relying on the LLM to remember and enforce rules via instructions alone. Rules get lost in long contexts or ignored under prompt pressure.

<!-- session:s-mmsd3s34-a6au at:2026-03-15T23:04:45.818Z -->
### Multi-agent audit before major refactors

**Pattern:** Run pattern-recognition-specialist, security-sentinel, and architecture-strategist in parallel before implementing structural changes. Consolidate findings into a plan; prioritize low-risk fixes first.

**Anti-pattern:** Implementing refactors (split files, move modules) without an audit. Miss security gaps, duplication, or schema bugs.

<!-- session:s-onboarding-adapter-split at:2026-03-16 -->

### [P1] Tool-native directories over "portable" conventions

**Pattern:** Write to each tool's native directory (`.cursor/skills/`, `.claude/skills/`, `.agents/skills/`). Canonical content lives in `.ai/skills/`; tool directories get stubs pointing there.

**Anti-pattern:** Writing to a single "portable" directory (`.agents/skills/`) for all tools. Creates unexplained directories for tools that don't use them and violates each tool's expected conventions.

### [P1] Verify documentation matches code after structural changes

**Pattern:** After any adapter/path change, grep the entire codebase for stale references. Docs, evals, CI tests, and READMEs all reference paths — they drift silently.

**Anti-pattern:** Updating code but not docs. Users see contradictory instructions. Evals check wrong paths and report false results.

<!-- session:s-mmt9kmqs-x0af at:2026-03-16T14:13:39.749Z -->
### [P1] Tool path mappings for read_tool_config

**Pattern:** Each AI tool has different config layout. Cursor: .cursor/rules/, .cursor/skills/, .cursor/mcp.json. Claude Code: no rules dir (uses CLAUDE.md + hooks), .claude/skills/, .mcp.json. Antigravity: .agents/rules/, .agents/skills/; MCP is global. Windsurf/Cline: rulesPath + mcpPath only.

**Anti-pattern:** Assuming .claude/rules/ exists; Claude Code uses CLAUDE.md. parseRulesDir returns [] for tools without rules dir.

<!-- session:s-workflow-rules at:2026-03-16 -->

### [P0] Save project learnings to .ai/memory/, not tool-native memory

**Pattern:** All project learnings, feedback, and decisions go to `.ai/memory/` via `commit_memory`. Tool-native memory (Claude's `~/.claude/projects/`, Cursor's internal memory) is for user preferences only.

**Anti-pattern:** Saving project-specific feedback (workflow rules, branch conventions, coding standards) to the agent's own memory system. Other agents and tools can't see it. The same feedback has to be repeated in every tool.

<!-- session:s-audit-consistency at:2026-03-16 -->

### [P1] Only ship what's tested

**Pattern:** Before listing a tool as "supported," ensure it has: adapter entry, INSTALL.md, environment-specs entry, tool-inspect mapping, and at least one manual test run. Comment out untested tools rather than removing them — keeps the code ready for future onboarding.

**Anti-pattern:** Listing tools as supported based on theoretical compatibility. Creates inconsistencies across 5+ files and misleading documentation.