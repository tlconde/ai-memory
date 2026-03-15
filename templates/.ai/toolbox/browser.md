---
id: browser
type: toolbox
status: active
---

# Browser & Testing Patterns

How to use browser tools (Playwright, Chrome, Puppeteer) with ai-memory.

## Capture test results as memory

After running browser tests:
- **Failures** → write to `debugging.md` via `commit_memory` with symptom, screenshot path, and root cause
- **New patterns** → write to `patterns.md` (e.g., "modal always needs 500ms delay after animation")
- **Flaky tests** → tag as `[P1]` in debugging.md with reproduction steps

## Screenshot as evidence

When browser tools produce screenshots:
- Reference the screenshot path in memory entries
- Include the URL and viewport dimensions
- Tag entries with the component/page name for searchability

## Visual regression patterns

When visual differences are detected:
- Check memory for known acceptable changes (`search_memory` for the component)
- If the change was intentional (matches a decision in `decisions.md`), skip
- If unexpected, create a debugging entry with before/after paths
