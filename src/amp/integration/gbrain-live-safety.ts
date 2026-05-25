/**
 * Helpers for opt-in live gbrain integration test safety reporting.
 */

export const AMP_LIVE_FRAME_ID_PREFIX = "live-v1-";
export const AMP_LIVE_PROJECT_REF = "amp-live-verification";
export const AMP_LIVE_SLUG_PREFIX = "amp/frames/h.";

export interface LiveGbrainCleanupReport {
  slug: string;
  frameId: string;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean;
  deleteStatus?: string;
  residualPageWarning?: string;
}

/** True when frame id follows AMP live test naming (unique per run). */
export function isAmpOwnedLiveFrameId(frameId: string): boolean {
  return frameId.startsWith(AMP_LIVE_FRAME_ID_PREFIX);
}

/** Build operator-facing residual page warning after failed cleanup. */
export function formatResidualPageWarning(report: LiveGbrainCleanupReport): string {
  const lines = [
    "Live gbrain cleanup incomplete — a page may remain in your database.",
    `  slug: ${report.slug}`,
    `  frame_id: ${report.frameId}`,
  ];

  if (report.deleteStatus) {
    lines.push(`  delete_status: ${report.deleteStatus}`);
  }

  lines.push(
    "  PROVISIONAL: gbrain delete_page may soft-delete (~72h recoverable via restore_page).",
    `  Inspect: gbrain list/search for slug prefix ${AMP_LIVE_SLUG_PREFIX}`,
    "  AMP does not auto-delete or migrate legacy slug encodings."
  );

  return lines.join("\n");
}

/** Interpret delete_page tool result for cleanup success (PROVISIONAL semantics). */
export function interpretDeletePageCleanup(
  deleteResult: unknown
): Pick<LiveGbrainCleanupReport, "cleanupSucceeded" | "deleteStatus"> {
  const status =
    typeof deleteResult === "object" && deleteResult !== null
      ? (deleteResult as { status?: string }).status
      : undefined;

  const cleanupSucceeded = status === "soft_deleted" || status === "deleted";
  return { cleanupSucceeded, deleteStatus: status };
}
