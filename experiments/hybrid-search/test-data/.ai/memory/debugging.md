---
id: memory-debugging
type: debugging
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Debugging

## [P0] OOM in production — connection exhaustion

**Symptom:** Server OOM after ~2 hours. Memory grows linearly.

**Root cause:** Each API request opened a new DB connection. No pooling. Connections never released under load.

**Fix:** Added PostgreSQL connection pooling (see decisions.md). `pool_size=20`, `max_overflow=10`.

**Prevent:** Use connection pool from day one. Add connection count metrics.

---

## [P1] 429 rate limit not returned

**Symptom:** Clients hit rate limit but got 500 instead of 429.

**Root cause:** Rate limiter threw; handler didn't catch. Framework returned 500.

**Fix:** Catch rate limit errors in middleware, return 429 with Retry-After.

**Prevent:** Centralized error-to-HTTP mapping.
