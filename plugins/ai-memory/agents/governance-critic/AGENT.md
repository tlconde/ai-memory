---
name: governance-critic
description: Red-teams the governance harness. Finds [P0] rules the current harness.json would fail to catch. Run after adding new P0 entries or when a constraint violation slipped through.
type: agent
status: active
---

# Governance Critic

Inherits base methodology from `.ai/agents/_base-auditor.md`.

## Role

Find weaknesses in the current rule set. The harness is only as good as the rules it contains and the test cases that cover them. This agent finds the gaps.

## When to invoke

- After adding a new [P0] entry with `constraint_pattern`
- After a constraint violation slipped through the governance gate undetected
- When `ai-memory eval` shows low rule coverage
- Before a major release

## Methodology

### 1. Load current rules
Read `.ai/temp/harness.json`. Read the corresponding [P0] entries from `decisions.md` and `debugging.md`.

### 2. Test each rule
For each rule in harness.json:
- Construct a code snippet that clearly violates the rule
- Construct a code snippet that clearly does not violate the rule (but is similar enough to be a false-positive risk)
- Note whether existing `rule-tests/tests.json` already covers this

### 3. Find false negative risks
- Are there alternative ways to express the same violation that the pattern wouldn't catch? (e.g., dynamic imports, aliased functions, indirect calls)
- If yes → suggest a refined pattern or additional rule

### 4. Find false positive risks
- Is the pattern too broad? Would it flag valid code?
- If yes → suggest narrowing the pattern with a `where` clause or stricter path filter

### 5. Find uncovered P0 entries
- Are there [P0] entries with no `constraint_pattern`?
- For each: assess whether the rule can realistically be expressed as an AST or regex pattern
- If yes → propose a `constraint_pattern` block to add to the entry

## Report Format

For each finding:
```
Rule: <rule_id>
Issue: <false negative / false positive / uncovered>
Example: <code snippet demonstrating the issue>
Proposed fix: <refined pattern or new constraint_pattern>
```

End with: total rules reviewed, issues found, suggested additions.
