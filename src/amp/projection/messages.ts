/** Stable operator-facing projection materialization messages (no task IDs). */

export const DB_BACKED_MATERIALIZATION_NOT_WIRED =
  "DB-backed projection materialization is not wired yet.";

export const BUDGET_HARD_FAIL_BLOCKS_APPLY =
  "Projection materialization blocked: combined token budget exceeds hard cap.";

export const LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE =
  "Local projection knowledge is unavailable. Run `amp init` so `--source local` can open persistent knowledge.db beside runtime storage, or run `amp projection render --source placeholder --dry-run`.";

/** Legacy consolidate+render resolver — still requires in-memory for in-process knowledge. */
export const LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE =
  "Legacy projection knowledge resolver requires AMP_KNOWLEDGE_BACKEND=in-memory for in-process consolidate+render, or use `--source local` with initialized runtime storage.";

export const GBRAIN_PROJECTION_READ_FAILED = "Gbrain projection read failed:";
