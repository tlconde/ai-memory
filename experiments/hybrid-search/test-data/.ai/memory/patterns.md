---
id: memory-patterns
type: pattern
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Patterns

## [P0] Error handling in API routes

**Pattern:** Wrap handlers in try/catch, return `{ error, code }` JSON. Log server-side.

**Anti-pattern:** Let errors bubble to framework. Exposes stack traces.

---

## [P1] Database migrations

**Pattern:** One migration per logical change. Include rollback. Run in CI.

**Anti-pattern:** Manual schema edits. No rollback script.

---

## [P2] Connection pooling usage

**Pattern:** Acquire from pool, use, release. Never hold connections across async boundaries.

**Anti-pattern:** Opening raw connections per request. Forgetting to close.
