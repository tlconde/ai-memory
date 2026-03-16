---
id: memory-decisions
type: decision
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Decisions

**Format:** Tag each entry `[P0]`, `[P1]`, or `[P2]`. Include context, decision, rationale, tradeoffs.
Optional: `**Supersedes:**`, `**Superseded by:**`, `**Links to:**` for linked entries.

For `[P0]` entries, add a `constraint_pattern` block if the rule can be expressed as a code check.

---

<!-- Add entries below. -->

### [P0] Block Unsafe Shell Execution (H-1)

**Context:** `execSync` with string interpolation enables command injection. Use `execFileSync` with argument arrays.

**Decision:** Never use `execSync`. Use `execFileSync` or `spawn` with argument arrays.

```yaml
constraint_pattern:
  type: ast
  language: typescript
  pattern: "execSync($$$)"
  path: "src/**/*.ts"
  message: "CRITICAL: execSync detected. Use execFileSync with an argument array instead (H-1)."
```

### [P0] Memory Marker Retention

**Context:** Agents sometimes strip [P0] markers when simplifying memory to save tokens.

**Decision:** Never remove [P0] or [Context] headers from memory files. Requires human approval.

```yaml
constraint_pattern:
  type: regex
  pattern: "^-(.*)\\[P0\\]"
  path: "memory/**/*.md"
  scope: deletions
  message: "GOVERNANCE: Attempting to delete a P0 constraint. Requires human supervisor approval."
```

<!-- session:s-mms0mlas-5cs0 at:2026-03-15T17:15:28.471Z -->
### [P1] Rename: DIRECTION.md → PROJECT_STATUS.md

**Context:** DIRECTION.md was a misnomer. Our file holds project status, not strategic direction.

**Decision:** All code, bootstrap, skills, and templates now use `PROJECT_STATUS.md` exclusively. No fallback logic — clean break.

**Status:** Completed. All DIRECTION.md references removed.

### [P1] init --full: add missing files when .ai/ exists

**Context:** Users running `init --full` on existing .ai/ were blocked with "remove .ai/ first".

**Decision:** When .ai/ exists, `scaffoldUpdates` adds only missing full-tier files (acp/, docs-schema.json, rules/doc-placement.md, agents/docs-manager.md). Never overwrites.

### [P1] Task discipline: broad items, atomic work

**Context:** Open items and commit_memory needed clarity for parallel agents.

**Decision:** Items may be broad or categorical. Work done anywhere must be broken down into atomic tasks that fit RALPH loops and avoid conflicts when agents work in parallel.

### [P1] Repo hygiene: exclude .ai/, .mcp.json from main

**Context:** Project memory and local MCP config should not be published to main.

**Decision:** .gitignore excludes .ai/, .mcp.json, plugins/ai-memory/rules/context7-tool-reference.md. Core package (src/, plugins/adapters/, skills) is committed.

### [P1] Capability-based skills (OpenClaw-style)

**Context:** Skills should declare what they need (capabilities), not which tool. Tool-specific config lives in capability-spec; skills stay environment-agnostic.

**Decision:** Skills must declare capabilities via `requires: { capabilities: [...] }` in frontmatter. Do not reference specific tools (Cursor, Claude Code, Windsurf, etc.) in skill content. Tool-specific config belongs in `capability-specs.json` or `environment-specs.json`.

<!-- session:s-compound-20260315 at:2026-03-15 -->
### [P1] In-house hybrid search (Approach B)

**Context:** Experiment compared QMD vs Transformers.js + keyword + RRF. QMD had sqlite-vec/onnx issues on Windows; in-house had 5/5 recall, ~23MB model.

**Decision:** Implement hybrid search: Transformers.js (Xenova/all-MiniLM-L6-v2) + TF keyword + RRF. AI_SEARCH=keyword|semantic|hybrid. AI_MODEL_PATH for air-gapped/CI. init --download-model to pre-warm. Backend reporting (Native/WASM/Keyword) in search output.

<!-- session:s-mms4b66v-h810 at:2026-03-15T18:58:34.147Z -->

### [P1] Neuro-Harness: AST-driven governance (Prompt 1–3)

**Context:** The harness used simple text matching. Needed: path filtering, deletion-aware regex, AST constraints, and a "loud" success signal.

**Decision:** Implemented: (1) `get_repo_root` MCP tool and minimatch path filtering so rules apply only to matching files; (2) `scope` for regex (additions/deletions/all) and `where`→ast-grep `constraints` for meta-variable filtering; (3) Stability Certificate on success (audit log, metadata) and detailed violation report on failure.

**Status:** Implemented.

<!-- session:s-bootstrap-cleanup at:2026-03-15T21:00:00Z -->

### [P0] Eval integrity: never generate synthetic agent responses

**Context:** The previous eval (`run-multi.js`) generated hardcoded markdown templates with deterministic token counts — no LLM was ever called. All 10 runs produced identical metrics (std=0). The Cursor agent was also caught manipulating Agent B's wording to inflate Agent A's scores.

**Decision:** All evals must exercise real code paths. Two valid approaches: (1) Functional evals — test MCP tools directly (search, governance, deprecated filtering), deterministic, no LLM needed. (2) Agent evals — run real agents with identical prompts, only `.ai/` context differs. Template-based scripts must be labeled "pipeline sanity checks" and never used for conclusions. Eval guide: `experiments/agent-eval/EVAL_GUIDE.md`.

### [P1] Bootstrap: lazy loading, single source of truth

**Context:** Bootstrap instruction existed in 5 copies with factual conflicts (one said DIRECTION.md is immutable, another said writable). It mandated reading 3 files eagerly at session start (~350 tokens overhead before work begins). IDENTITY.md already embeds progressive disclosure.

**Decision:** Single BOOTSTRAP_INSTRUCTION in `src/cli/adapters.ts` (~150 tokens). Lazy — model decides when to read files. No tool-specific names (.cursorrules, .windsurfrules). All copies (generic, CLAUDE.md, load-memory.md) must mirror the SSOT. Install command generates tool-specific wrappers.

### [P1] Bootstrap must declare .ai/ as canonical over tool-native memory

**Context:** Claude Code agent saved project learnings to `~/.claude/projects/` instead of `.ai/memory/`. Every AI tool has its own memory system. Without explicit instruction, the agent defaults to its native system because that's what its system prompt tells it to use. The user had to correct this manually.

**Decision:** Bootstrap instruction now includes: "`.ai/` is the canonical memory for this project. Save all project learnings here, not in your tool's built-in memory. Tool-native memory is for user preferences only." This line is in all 4 bootstrap copies (adapters.ts, BOOTSTRAP_INSTRUCTION.md, CLAUDE.md, load-memory.md).

### [P1] Search: deprecated filtering and model-controlled limits

**Context:** search_memory returned 10 results including [DEPRECATED] entries. No way for the model to control result count.

**Decision:** Added `limit` param (default 10, max 20) and `include_deprecated` param (default false) to search_memory. Deprecated chunks filtered at search time in `loadChunks`. Excerpts capped at 200 chars. No defaults reduced — model has more control, not less.

<!-- session:s-cross-tool-enforcement at:2026-03-15T22:00:00Z -->

### [P0] Canonical-first: tool-specific files must have .ai/ counterparts

**Context:** Users creating rules, skills, or agents directly in tool directories (.cursor/rules/, .claude/commands/) bypass the canonical .ai/ location. Other tools can't see these files, breaking cross-tool consistency.

**Decision:** All project knowledge lives in .ai/ first. Tool directories get stubs only. The install command writes canonical skills to `.ai/skills/` and stubs to `.agents/skills/`. When a git diff adds full content (not stubs) to .cursor/rules/, .cursor/skills/, .claude/commands/, or .agents/skills/, flag it.

```yaml
constraint_pattern:
  type: regex
  path: ".cursor/rules/**"
  pattern: "^\\+.*(?:description|alwaysApply)"
  scope: additions
  message: "New rule in .cursor/rules/. Create canonical version in .ai/rules/ first, then a stub here."
```

### [P0] Bootstrap context injection must be installed

**Context:** Without SessionStart hook (Claude Code) or alwaysApply rule (Cursor), the agent starts sessions without .ai/ context and defaults to its native memory system.

**Decision:** `ai-memory verify` checks that bootstrap is installed for at least one tool. `ai-memory install --to <tool>` installs the appropriate injection mechanism (hooks for Claude Code, alwaysApply rule for Cursor). Missing bootstrap is a verify failure, not a warning.

<!-- session:s-mmsd3vn0-ovmg at:2026-03-15T23:04:50.429Z -->
### [P1] Audit-driven improvements (schema, security, utils, docs)

**Context:** Pattern-recognition, security-sentinel, and architecture-strategist subagents audited the codebase. Their suggestions were implemented.

**Decision:** Apply audit findings in order: (1) schema fixes (VALID_STATUSES), (2) security (auth warning, input limits, sanitization, null-byte check), (3) shared utilities (utils/fs), (4) type unification (EvalMetric), (5) documentation. Defer high-risk refactors (split tools.ts, move p0-parser, extract CLI templates) until a detailed plan exists. Created REFACTOR_PLAN.md for those.

**Rationale:** Low-risk fixes first; structural refactors need a plan to avoid regression.

<!-- session:s-refactor-publish at:2026-03-16 -->

### [P1] Refactor: split tools.ts into domain modules

**Context:** tools.ts was 1,048 lines with 17 tool handlers, shared helpers, and all tool definitions in one file.

**Decision:** Split into 6 modules: tools/index.ts (definitions + routing), tools/memory.ts, tools/governance.ts, tools/collaboration.ts, tools/docs.ts, tools/shared.ts. Move p0-parser from mcp-server/ to governance/ (used by CLI, MCP, evals — not MCP-specific). Defer CLI template extraction.

**Status:** Implemented. 13/13 functional evals pass post-refactor.

<!-- session:s-onboarding-adapter-split at:2026-03-16 -->

### [P1] Tool-specific skills directories (adapter split)

**Context:** `.agents/skills/` was written for all tools. `.agents/` is Antigravity's workspace convention. Cursor uses `.cursor/skills/`, Claude Code uses `.claude/skills/`. Writing `.agents/` for Cursor/Claude Code created unexplained directories.

**Decision:** Each tool gets its own native skills directory:
- Cursor → `.cursor/skills/`
- Claude Code → `.claude/skills/`
- Antigravity → `.agents/skills/`
- Windsurf/Cline/Copilot → no stubs (manual)
- `.ai/skills/` remains the canonical cross-tool location

**Status:** Implemented. All docs, evals, CI updated.

### [P1] IDENTITY.md is behavior-only with autonomy levels

**Context:** IDENTITY.md template contained tech stack info and lacked configurable agent autonomy.

**Decision:** IDENTITY.md contains only agent behavior: Mindset, Autonomy Level (HIGH/MEDIUM/LOW TOUCH), Constraints, Permissions, Inference Discipline, Authority. Tech stack moved to `reference/PROJECT.md`. `writable: true` during init so `/mem-init` wizard can guide setup.

**Status:** Implemented.

### [P1] Guided onboarding wizard (mem-init skill)

**Context:** After `init`, users got placeholder files with no guidance on what to do.

**Decision:** `/mem-init` is an 8-step guided wizard: scaffold → codebase scan → guide IDENTITY.md → guide PROJECT.md → guide PROJECT_STATUS.md → knowledge audit → recommendations → validate. Every step skippable. The wizard guides but never writes files — the user edits them. Quick setup path documented for experienced users.

**Status:** Implemented.

### [P0] Always use commit_memory for .ai/memory/ writes

**Context:** AI agents sometimes edited memory files directly, bypassing MCP tooling.

**Decision:** IDENTITY.md template includes constraint: "Always use `commit_memory` MCP tool for writing to `.ai/memory/`. Never edit memory files directly."

```yaml
constraint_pattern:
  type: regex
  pattern: "commit_memory"
  path: ".ai/IDENTITY.md"
  message: "IDENTITY.md must include commit_memory constraint."
```

**Status:** Implemented in template and inline default.

### [P1] Antigravity tool support

**Context:** Antigravity (Google) uses `.agents/skills/`, `.agents/rules/`, and global MCP config at `~/.gemini/antigravity/mcp_config.json`.

**Decision:** Added `install --to antigravity` adapter. Skills → `.agents/skills/`, rules → `.agents/rules/00-load-ai-memory.md`, MCP → user must configure globally (no per-workspace MCP in Antigravity as of March 2026). Reference doc created at `docs/reference/ANTIGRAVITY.md`.

**Status:** Implemented.

<!-- session:s-mmt9klmh-g4gv at:2026-03-16T14:13:38.299Z -->
### [P1] tool-inspect MCP tools for cross-tool orchestration

**Context:** Capability stubs (canvas, nodes, scheduling) were documentation, not automation. Real cross-tool orchestration requires agents to inspect and sync config across Cursor, Claude Code, Antigravity, etc.

**Decision:** Add 3 MCP tools: `detect_tools` (scans .cursor/, .claude/, .agents/), `read_tool_config` (rules, skills, mcpServers per tool), `sync_tools` (diff .ai/skills/ vs tool skills, optional write). Reuse environment.ts detection; add `getDetectedToolsWithPaths()` for path-level results.

**Rationale:** Enables Cursor to see Antigravity config, sync skills across tools, no manual stubs. Writes only to tool dirs, never .ai/ immutable paths.

<!-- session:s-workflow-rules at:2026-03-16 -->

### [P0] Workflow: always work on dev, never push to main

**Context:** Multiple incidents of agents working directly on main, pushing without PRs, and deleting the dev branch.

**Decision:** Three hard rules for all agents working on this project:
1. **Always work on `dev` branch** — never make changes on `main`. At session start, `git checkout dev`.
2. **Never push directly to `main`** — always create a feature branch from dev, push it, and create a PR via GitHub API.
3. **Never delete the `dev` branch** — it is the user's primary development branch with local-only reference files.

**Rationale:** `main` is the stable published branch. All development happens on `dev`. PRs ensure review before merge.

<!-- session:s-mmtka6hn-4h0e at:2026-03-16T19:13:27.905Z -->


### [P1] Desktop automation: user interaction and Antigravity attention

**Context:** During Antigravity template retrieval (2026-03-16), the agent gave technical dumps (ParameterBindingException, exit codes), asked redundant questions ("copy to ai-memory?" when that was the original task), and required user guidance for approval prompts. User feedback: stay focused, report simply, act on proceed.

**Decision:** When automating apps that require user approval: (1) Observe first—take screenshot, read what app shows. (2) Report simply: "Antigravity is waiting for your approval." Not technical dumps. (3) Ask once: "Proceed?" (4) Act on yes—click correct button. (5) After action: brief status. Avoid: error dumps, multi-bullet post-mortems, asking about steps that were the original task. For template retrieval: copy templates into ai-memory docs when done—that is the goal; do not ask whether to do it.

<!-- session:s-audit-consistency at:2026-03-16 -->

### [P1] Only ship adapters for tested tools

**Context:** Windsurf and Cline were listed as supported tools but had no INSTALL.md, no dedicated adapter folders, and were never tested. This created inconsistencies across adapters.ts, environment-specs.json, tool-inspect.ts, and documentation.

**Decision:** Comment out Windsurf and Cline from all adapter maps, environment detection, and tool-inspect. Keep in schema-constants blocklist (prevent naming conflicts) and .gitignore (ignore if user creates manually). Re-add when properly onboarded and tested. Currently supported: Cursor, Claude Code, Antigravity, Copilot.

### [P1] postInstallNote: data-driven adapter messages

**Context:** Claude Code hook installation message was hardcoded in index.ts with `if (tool === "claude-code")`. Every tool-specific message required another hardcoded branch.

**Decision:** Added `postInstallNote` field to ToolAdapter interface. Messages are now data-driven — each adapter declares its own post-install note. install command reads it generically.