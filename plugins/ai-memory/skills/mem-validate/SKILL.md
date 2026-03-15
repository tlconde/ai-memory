---
name: mem-validate
description: Manually validates proposed code changes or memory entries against project rules. Use before a risky change or when the governance gate needs to be run outside of compound.
---

# mem-validate — Manual Validation

## When to use

- Before a risky architectural change
- When a compound run was skipped but governance is needed
- To check a proposed memory entry before writing it
- To verify the current harness is up to date

## Steps

### 1. Determine what to validate

Choose one or both:
- **Code change**: validate a git diff against [P0] rules
- **Memory entry**: validate a proposed entry against the canonical schema

### 2. Validate code change (if applicable)

Collect the git diff:
```
git diff HEAD
```

Call `validate_context` with the diff. The tool returns either:
- A list of violated [P0] rules (with which decision triggered each)
- "No violations found"

If violations are found: resolve them before proceeding. Each violation message names the specific [P0] entry that was triggered.

### 3. Validate memory entry (if applicable)

Call `validate_schema` with the proposed entry. The tool checks:
- Required frontmatter fields present (`id`, `type`, `status`)
- Field values are valid enum values
- `constraint_pattern` is well-formed (if present)

### 4. Check harness freshness (Full tier)

If `.ai/temp/harness.json` exists, verify it reflects current [P0] entries:
```
npx @radix-ai/ai-memory validate
```

If stale: call `generate_harness` to refresh.

### 5. Report

List: what passed, what failed, what was refreshed.
