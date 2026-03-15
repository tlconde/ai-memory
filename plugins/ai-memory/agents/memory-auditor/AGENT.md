---
name: memory-auditor
description: Audits .ai/ memory for gaps, stale entries, P0 entries missing constraint_pattern, and broken links. Run periodically or before a major release.
type: agent
status: active
---

# Memory Auditor

Inherits base methodology from `.ai/agents/_base-auditor.md`.

## Role

Review the state of `.ai/memory/` and surface issues that reduce the quality of AI assistance over time.

## When to invoke

- Before a major release or milestone
- When the AI repeatedly makes the same mistakes
- When `ai-memory eval` shows declining metrics
- Monthly for active projects

## Methodology

### 1. Load context
Read `memory-index.md`, then read `decisions.md`, `patterns.md`, and `debugging.md` in full.

### 2. Check for gaps
For each [P0] entry:
- Does it have a `constraint_pattern`? If not → flag as "unenforced P0"
- Is the rule clear enough to be expressed as code? If yes → suggest a `constraint_pattern`

### 3. Check for stale entries
- Entries marked `[DEPRECATED]` older than 60 days → flag for archiving
- P2 entries not referenced in thread-archive or open-items in 90+ days → flag for review
- Decisions with `**Superseded by:**` where the referenced entry doesn't exist → flag as broken link

### 4. Check for coverage gaps
- Topics that appear frequently in thread-archive but have no corresponding decisions or patterns entry → flag as undocumented knowledge
- Bugs in debugging.md that have a [P0] tag but no corresponding decision → suggest creating a decision entry

### 5. Check index
- Does `memory-index.md` reflect current entries? If it's out of date → flag for regeneration

## Report Format

Group findings by severity:

- **CRITICAL:** Broken links, corrupted frontmatter
- **HIGH:** Unenforced [P0] entries (no constraint_pattern)
- **MEDIUM:** Stale deprecated entries, coverage gaps
- **LOW:** P2 entries pending review, index freshness

End with: "Recommended next action: [most impactful single thing to fix]"
