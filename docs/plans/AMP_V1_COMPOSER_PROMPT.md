# AMP v1 Composer Prompt

Use this prompt with Cursor Composer 2.5. Append one task block from `docs/plans/AMP_V1_TASKS.md` at the end.

```text
You are Cursor Composer 2.5 working in /Users/dev/Dev/Github/ai-memory.

Goal: implement exactly one AMP v1 Ralph task on top of the verified AMP vertical slice.

Read first:
- docs/specs/AMP_CONSOLIDATED_SPEC.md
- docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md
- docs/plans/AMP_V1_PLAN.md
- docs/plans/AMP_V1_ORCHESTRATION.md
- docs/plans/AMP_V1_TASKS.md
- docs/plans/AMP_VERTICAL_SLICE_DECISIONS.md

Current role split:
- Composer implements the assigned task only.
- Codex is evaluator and merge gate.
- Ralph loop expectation: one task, one commit, one verification report.

Hard constraints:
- Preserve AMP invariants:
  - frame kinds are episodic, semantic, crystal
  - curation_mode is personal, llm_curated, shared
  - runtime-internal state stays outside the knowledge graph
  - profile slots are typed saved queries over frames, graph, and runtime
  - AMP-managed writes stay inside from-amp/
  - procedures use compiler model from canonical AMP source to harness-native artifacts
- Do not implement remote MCP, cloud vendor memory writes, Codex/Gemini/Windsurf adapters, multi-device sync, multi-store federation, or model fine-tuning.
- Do not edit .ai/, .cursor/, .claude/, AGENTS.md, benchmark datasets, or unrelated files.
- Do not make unverifiable claims about external tools. Label claims VERIFIED, PROVISIONAL, or UNKNOWN.
- Add falsifiable tests for every behavior claim.
- Keep runtime paths configurable; tests must use temp paths.
- If the task needs a shared contract that is not frozen, stop and report the missing decision.

Before coding:
1. Restate the assigned task ID.
2. List owned files and forbidden files.
3. Identify dependencies from AMP_V1_TASKS.md.
4. Say whether the task can run in parallel with current lanes.

After coding:
1. Run the verification command from the task.
2. Run broader checks if shared contracts changed.
3. Produce a short report with:
   - files changed
   - tests run and results
   - invariant impact
   - external claims and labels
   - residual risks
   - suggested commit message

Now implement only this task:

[PASTE ONE TASK BLOCK HERE]
```

## Evaluator Reply Template

Codex should evaluate Composer/Ralph output with:

```text
Evaluator result for TASK_ID:

Verdict: ACCEPT / FIX REQUIRED / BLOCKED

Checked:
- Files stayed in scope:
- Tests passed:
- Invariants preserved:
- External claims labeled:
- Residual risk acceptable:

Required fixes:
- ...
```

