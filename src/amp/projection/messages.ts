/** Stable operator-facing projection materialization messages (no task IDs). */

export const DB_BACKED_MATERIALIZATION_NOT_WIRED =
  "DB-backed projection materialization is not wired yet.";

export const BUDGET_HARD_FAIL_BLOCKS_APPLY =
  "Projection materialization blocked: combined token budget exceeds hard cap.";

export const LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE =
  "Local projection source requires an offline knowledge backend. Set AMP_KNOWLEDGE_BACKEND=in-memory or run `ai-memory amp projection render --source placeholder --dry-run`.";

export const GBRAIN_PROJECTION_IN_MEMORY_BACKEND =
  "Gbrain projection source reads from gbrain, not in-memory knowledge. Use `--source local` with AMP_KNOWLEDGE_BACKEND=in-memory for offline projection.";

export const GBRAIN_PROJECTION_READ_FAILED = "Gbrain projection read failed:";
