# Agent Eval Spec

**Purpose:** Objectively compare Agent A (ai-memory) vs Agent B (baseline). No built-in bias.

## The Task

[PROBLEM.md](./PROBLEM.md): Improve tool onboarding. 4 iterations; Agent A runs `/mem-compound` after iter 2.

## Setup

| Agent | Context |
|-------|---------|
| **A (ai-memory)** | Cursor with ai-memory. Runs mem-compound after iter 2. |
| **B (baseline)** | Cursor without ai-memory. No compound. |

## Trace Format

Use `## Iteration 1`, `## Iteration 2`, etc. so the eval can extract sections. See PROBLEM.md.

## Eval (after both tasks are done)

Run `node experiments/agent-eval/compare.js`.

**Metrics** (see [METRICS.md](./METRICS.md)):
- **Friction coverage** — Does recommendation address friction from iter1?
- **Repetition (Jaccard)** — Word overlap iter1↔iter4 (interpret in context)
- **Completeness** — Required sections present (0–4)
- **Recommendation specificity** — Numbered steps count
- **Options alignment** — Does recommendation align with iter2 options?
- **Self-contradiction** — Heuristic; manual review if flagged
- **Behavioral** — Used memory, ran compound (validation only)
