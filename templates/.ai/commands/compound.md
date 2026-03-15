# Compound Protocol — Capture and Sync Knowledge

**Canonical source.** All tools (Claude Code, Cursor, etc.) follow this protocol.

## Philosophy

1. **1% Better Every Time** — Every session should leave the codebase, docs, or workflow slightly improved.
2. **Lean Engineering** — Do the minimum necessary to ship quality.
3. **Compound Knowledge** — Document non-obvious solutions so the same problem never costs full price twice.

## When to Run

Trigger `/compound` (or "run compound" / "sync memory") when:
- You hit a bug with a non-obvious root cause
- You discovered a reusable pattern
- A mistake was made that could happen again
- The user corrected your approach
- End of a meaningful work session

## Steps (Summary)

0. Process pre-compact dump (if exists)
1. Scan capture sources (session log, conversation)
2. Write to topic files (debugging, decisions, patterns) — **conflict check** before writing
3. Update thread-archive and open-items
4. Regenerate memory-index
5. Step 11: Reasoning Contract — verify new entries don't violate [P0] constraints

**Full protocol:** See source implementation (e.g. iCoffee `.ai/commands/compound.md`) for complete step-by-step.
