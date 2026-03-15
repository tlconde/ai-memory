---
id: memory-decisions
type: decision
layout: multi-entry
status: active
last_updated: 2026-03-15
---

# Decisions

## [P0] PostgreSQL connection pooling

**Context:** Production OOM after 2 hours of load. Connection exhaustion.

**Decision:** Use PostgreSQL connection pooling with `pool_size=20`, `max_overflow=10`. Set in `database.yml`. Configure via `DATABASE_POOL_SIZE` env.

**Rationale:** Each request was opening a new connection. Pooling prevents exhaustion and improves latency.

**Links to:** debugging.md (OOM incident)

---

## [P1] Authentication strategy

**Context:** Need auth for API and web dashboard.

**Decision:** Use JWT for API, session cookies for web. Shared user store in PostgreSQL. No OAuth for MVP.

**Rationale:** JWT stateless for API; sessions for browser. Keep it simple.

---

## [P2] API rate limiting

**Decision:** 100 req/min per API key. Return 429 with Retry-After header.

**Rationale:** Prevent abuse. Sufficient for internal tools.
