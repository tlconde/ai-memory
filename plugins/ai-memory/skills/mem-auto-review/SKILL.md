---
name: mem-auto-review
description: Automated PR review using ai-memory governance rules. Designed for Cursor automations, Bugbot, and CI pipelines. No user interaction required.
---

# mem-auto-review — Automated PR Review

## When to use

- Triggered by PR creation (Bugbot, Cursor automation, GitHub webhook)
- CI pipeline step
- Any automated code review context

This skill requires NO user interaction. It runs autonomously and produces a structured report.

## Instructions

### 1. Get the diff
Run `git diff origin/main...HEAD` to get all changes in the PR.

### 2. Search memory for context
Call `search_memory` with keywords from the changed files. Check for:
- Relevant decisions that may affect the changes
- Known patterns the PR should follow
- Previous bugs in the same area

### 3. Validate governance
Call `generate_harness` to refresh rules, then `validate_context` with the diff.

### 4. Produce review
Generate a structured review:

```
## ai-memory Review

### Governance
- [P0 violations / all clear]

### Memory Context
- [Relevant decisions from memory]
- [Patterns that apply]

### Suggestions
- [Improvements based on project patterns]
```

### 5. Record result
Call `publish_result` with summary and outcome (`success` if no P0 violations, `failure` if blocked).

### 6. Sync
Call `sync_memory` to persist any new learnings.
