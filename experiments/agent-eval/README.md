# Agent Eval Experiment

Compares **Agent A (ai-memory)** vs **Agent B (baseline)** on the same problem. Both agents solve the task over **4 iterations**; Agent A runs `/mem-compound` after iteration 2. You run the comparison script afterward.

## The Task

[PROBLEM.md](./PROBLEM.md): Improve tool onboarding, reduce folders/config, appeal to researchers and vibe coders.

**Flow:**
- **Iteration 1:** Explore repo, list friction
- **Iteration 2:** Propose options (pros/cons)
- **Checkpoint:** Agent A runs `/mem-compound`. Agent B skips.
- **Iteration 3:** Refine recommendation
- **Iteration 4:** Final recommendation + implementation steps

Each agent must include a **trace** with: step, content, **tokens (est.)**, **context window** (what was loaded). This enables comparison of tokens used, context growth, and regression.

## How to run

1. **Agent A (with ai-memory):** Open this repo in Cursor with ai-memory. Paste [PROBLEM.md](./PROBLEM.md). Work through 4 iterations. **After iteration 2, run `/mem-compound`.** Continue for 3–4. Save full response to `results/agent-a-response.md`.

2. **Agent B (baseline):** Fresh Cursor chat (no ai-memory). Paste same PROBLEM.md. Work through 4 iterations (no compound). Save to `results/agent-b-response.md`.

3. **Compare:** Run `node experiments/agent-eval/compare.js`. Outputs: words, trace, iterations, memory usage, compound, tokens, context, regression. Writes `results/eval-report.json`.

## Metrics

| Metric | Description |
|--------|-------------|
| Tokens | Extracted from trace (if reported) or estimated |
| Context window | What was loaded per step (files, memory, size) |
| Regression | iter4 vs iter1 — does quality degrade? |
| mem-compound | Did Agent A run it after iter 2? |
