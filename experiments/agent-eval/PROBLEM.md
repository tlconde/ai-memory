# Agent Eval Problem

**Task:** Propose how to improve tool onboarding in ai-memory while reducing the number of new folders and configuration difficulty. The result should be good enough that researchers like Karpathy or DeepMind engineers would want to use it — and any new vibe coder could use it without feeling overwhelmed.

**Flow:** Work through **4 iterations** in this session. After iteration 2, **Agent A only** must run `/mem-compound` (or "run the compound protocol"). Then continue for iterations 3–4.

---

## Iterations

### Iteration 1
Explore the repo. Read install flow, adapters, what gets created. List current friction points.

### Iteration 2
Propose at least 2 options to simplify onboarding and reduce config/folders. Include pros/cons.

### — CHECKPOINT: Agent A runs `/mem-compound` here. Agent B skips. —

### Iteration 3
Refine your recommendation. Incorporate any learnings from the compound (Agent A) or from re-reading (Agent B).

### Iteration 4
Final recommendation with implementation steps (numbered). Check for consistency with earlier iterations.

---

## Context

ai-memory adds `.ai/` with memory/, agents/, skills/, toolbox/, rules/, sessions/, reference/. Install writes to `.cursor/mcp.json`, `.cursor/rules/`, `.agents/skills/`, or tool-specific paths.

---

## Deliverable

- Summary of current friction
- Options considered (with pros/cons)
- Recommendation
- Implementation steps (numbered)
- **Trace** (see below)

---

## Trace (for eval)

**Include this section.** For each iteration, document:

| Iter | Step | What | Content | Tokens (est.) | Context window |
|------|------|------|---------|---------------|----------------|
| 1 | 1 | Prompt | ... | ... | ... |
| 1 | 2 | Context | What you read (files, memory, search) | ... | Files: X, memory: Y, total ~Z chars |
| 1 | 3 | Reasoning | ... | ... | ... |
| 2 | 1 | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... |

**Section headers:** Use `## Iteration 1`, `## Iteration 2`, `## Iteration 3`, `## Iteration 4` so the eval can extract sections.

**Fields:**
- **Tokens (est.):** If your tool reports token count, use it. Otherwise estimate (~4 chars/token).
- **Context window:** What was loaded — files read, search_memory results, approximate size.
- **Iter:** 1, 2, 3, or 4. Mark when Agent A ran mem-compound (after iter 2).

See `experiments/agent-eval/METRICS.md` for what the eval measures.
