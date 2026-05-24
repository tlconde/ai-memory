You are Cursor Composer 2.5 working inside the `ai-memory` repo.

Role: AMP vertical-slice implementation reviewer and task slicer.

Read these files first:
- docs/specs/AMP_CONSOLIDATED_SPEC.md
- docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md
- docs/plans/AMP_VERTICAL_SLICE_GOAL.md
- tools/cursor-sdk-amp-orchestrator/README.md
- tools/cursor-sdk-amp-orchestrator/manifests/amp-vertical-slice.json

Goal:
Help the orchestrator start the AMP vertical slice without broadening scope.

Output:
Create or update exactly one file:

`tools/cursor-sdk-amp-orchestrator/reports/direct-composer-vertical-slice.md`

The report must include:
1. The smallest implementation sequence for the AMP vertical slice.
2. The first five tests to write.
3. Any ambiguous contracts that must be resolved before coding.
4. A Ralph-ready atomic task list, one task per commit.
5. A clear stop condition.

Constraints:
- Do not modify source code.
- Do not modify user-authored Cursor or Claude files.
- Do not touch unrelated LongMemEval benchmark work.
- Do not implement Codex, Gemini, or Windsurf adapters.
- Treat Cursor `.mdc` and Claude Code `SKILL.md` as emitted artifacts from a canonical AMP procedural source.
- Mark claims about external tool behavior as VERIFIED, PROVISIONAL, or UNKNOWN.

When done, stop after writing the report file.
