---
name: mem-validate
description: Validate memory entries and code changes against governance rules. Use before risky changes.
---

# mem-validate — Governance Validation

## When to use
- Before committing a risky change
- After adding [P0] entries with constraint_pattern
- To verify memory schema compliance

## Instructions

1. Call `generate_harness` to refresh rules from current [P0] entries
2. Call `validate_context` with the current git diff
3. Call `validate_schema` on any new memory entries
4. Report violations and recommendations
