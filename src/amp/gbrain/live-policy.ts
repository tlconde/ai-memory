/**
 * Canonical live gbrain policy for AMP CLI, preflight, and integration tests.
 *
 * Falsifiable claim: live gbrain writes fail closed at backend creation unless
 * the operator explicitly confirms; reads may connect live without write confirmation.
 */

export const AMP_LIVE_GBRAIN_TEST_ENV = "AMP_LIVE_GBRAIN";
export const AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV = "AMP_CONFIRM_LIVE_GBRAIN_WRITE";

export const LIVE_GBRAIN_WRITE_CONFIRM_FLAG = "--confirm-live-gbrain-write";

export const AMP_LIVE_FRAME_ID_PREFIX = "live-v1-";
export const AMP_LIVE_PROJECT_REF = "amp-live-verification";
export const AMP_LIVE_SLUG_PREFIX = "amp/frames/h.";

export const LIVE_GBRAIN_READ_WARNING =
  "PROVISIONAL: live gbrain read — connects to gbrain serve (writes require --confirm-live-gbrain-write).";

export type KnowledgeBackendAccess = "read" | "write";

export interface LiveGbrainConfirmationOptions {
  confirmLiveGbrainWrite?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface LiveGbrainCleanupReport {
  slug: string;
  frameId: string;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean;
  deleteStatus?: string;
  residualPageWarning?: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Map CLI flags to write confirmation (deprecated alias handled at CLI boundary only). */
export function confirmLiveGbrainWriteFromCliOptions(options: {
  confirmLiveGbrainWrite?: boolean;
  deprecatedLiveGbrainAlias?: boolean;
}): boolean {
  return options.confirmLiveGbrainWrite === true || options.deprecatedLiveGbrainAlias === true;
}

/** True when operator explicitly confirmed live gbrain writes. */
export function isLiveGbrainWriteConfirmed(
  options: LiveGbrainConfirmationOptions = {}
): boolean {
  const env = options.env ?? process.env;
  if (options.confirmLiveGbrainWrite === true) {
    return true;
  }
  return isTruthyEnv(env[AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV]);
}

/** Fail closed before live gbrain writes when confirmation is missing. */
export function assertLiveGbrainWriteConfirmed(
  options: LiveGbrainConfirmationOptions = {}
): void {
  if (isLiveGbrainWriteConfirmed(options)) {
    return;
  }

  throw new Error(
    [
      "Live gbrain writes are disabled by default.",
      `Re-run with ${LIVE_GBRAIN_WRITE_CONFIRM_FLAG} or set ${AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV}=1.`,
      "Safe alternatives: --knowledge in-memory or --knowledge fake-gbrain.",
    ].join(" ")
  );
}

/** Whether opt-in live integration tests are enabled (AMP_LIVE_GBRAIN=1). */
export function isLiveGbrainTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnv(env[AMP_LIVE_GBRAIN_TEST_ENV]);
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
