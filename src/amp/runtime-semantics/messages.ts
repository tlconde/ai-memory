/** Stable operator-facing runtime semantics messages (no task IDs). */

/** Clause asserting explicit correction capture is wired on local typed storage. */
export const RUNTIME_EXPLICIT_CORRECTION_WIRED_CLAUSE =
  "available via inspect, seed, and correct";

export const RUNTIME_STATUS_LOCAL_STORAGE_NOTE =
  `Local typed runtime semantic storage is ${RUNTIME_EXPLICIT_CORRECTION_WIRED_CLAUSE}; queue capture and consolidation wiring remain incomplete.`;

/** Projection heading for active explicit correction episodic frames (RUNTIME-24/25). */
export const EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING =
  "Episodic correction (not durable truth)";

/** Projection heading when correction content is metadata-only (sensitivity redaction). */
export const EPISODIC_CORRECTION_METADATA_PROJECTION_HEADING =
  "Episodic correction (metadata only)";
