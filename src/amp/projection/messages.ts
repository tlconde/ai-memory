/** Stable operator-facing projection materialization messages (no task IDs). */

export const DB_BACKED_MATERIALIZATION_NOT_WIRED =
  "DB-backed projection materialization is not wired yet.";

export const BUDGET_HARD_FAIL_BLOCKS_APPLY =
  "Projection materialization blocked: combined token budget exceeds hard cap.";

export const LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE =
  "Local projection source requires an offline knowledge backend. Set AMP_KNOWLEDGE_BACKEND=in-memory or use `amp projection render --source placeholder --dry-run`.";
