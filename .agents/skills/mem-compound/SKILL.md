---
name: mem-compound
description: Captures session learnings into persistent memory. Use after a bug fix, pattern discovery, corrected approach, or at the end of any meaningful session.
---

# mem-compound — Capture Session Learnings

## When to use
- A bug had a non-obvious root cause
- A reusable pattern emerged
- An approach was corrected mid-session
- The session produced architectural decisions
- End of any session worth preserving

## Instructions

**Parallelism:** Steps 3–4 can run in parallel. Step 6 can run in parallel by domain. Step 8 runs in the background.

### 1. Scan the session
Review conversation, code changes, errors. Identify:
- Bugs with non-obvious causes → write to `debugging.md` via `commit_memory`
- Reusable patterns → write to `patterns.md` via `commit_memory`
- Decisions made → write to `decisions.md` via `commit_memory`
- Improvements → write to `improvements.md` via `commit_memory`

### 2. Conflict check
Before writing: call `search_memory` for each topic. If contradictions found, mark old entry `[DEPRECATED]`.

### 3. Update project status
Update `PROJECT_STATUS.md` (or `DIRECTION.md`) with learnings: move completed items to "What's Working", add new open questions, update "What to Try Next".

### 4. Archive
Call `publish_result` with summary, outcome, and learnings.
Update `sessions/open-items.md`: close resolved items, add new ones. **Task discipline:** Items may be broad or categorical. Work done anywhere must be broken down into atomic tasks that fit RALPH loops and avoid conflicts when agents work in parallel.

### 5. Governance gate (if harness.json exists)
Call `generate_harness`, then `validate_context` with git diff.

### 6. Project-specific updates
If the session touched docs or major areas, update project docs. Use `get_doc_path` before writing any doc — do not infer paths. Map session work to domains:

| Domain | When to update | Doc types (examples) |
|--------|----------------|----------------------|
| UI/Frontend | Design changes, components, styles | design-system |
| Backend/API | Endpoints, schemas, contracts | api-spec, api-guide |
| AI/ML | Models, prompts, evals | model-card, prompts |
| Architecture | ADRs, system design | adr |
| Backlog | Tasks, priorities | backlog |
| Major session | Significant learnings | decisions-archive, changelog |

Run Step 6 in parallel by domain where possible.

### 7. Regenerate memory-index
Read `memory/decisions.md`, `patterns.md`, `debugging.md`, `improvements.md`; create a priority-ranked summary (P0 → P1 → P2); call `commit_memory` with path `memory/memory-index.md` and `append: false` to overwrite. Or run `ai-memory index`.

### 8. Doc validation (background)
If `.ai/docs-schema.json` exists: call `validate_doc_placement` for any new or modified doc paths. Run in background; do not block compound completion.

### 9. Sync
Call `sync_memory` to persist .ai/ changes to git. Essential for all sessions with memory writes — not just ephemeral environments.

### 10. Report
Summarize: entries written, items opened/closed, gate result.
