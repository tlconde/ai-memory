/**
 * Live gbrain safety constants and confirmation helpers for AMP CLI.
 *
 * Falsifiable claim: live gbrain backend use fails closed unless the operator
 * explicitly opts in via flag or env.
 */

export const AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV = "AMP_CONFIRM_LIVE_GBRAIN_WRITE";
export const AMP_LIVE_GBRAIN_TEST_ENV = "AMP_LIVE_GBRAIN";

export const LIVE_GBRAIN_WRITE_CONFIRM_FLAG = "--confirm-live-gbrain-write";

export interface LiveGbrainConfirmationOptions {
  confirmLiveGbrainWrite?: boolean;
  env?: NodeJS.ProcessEnv;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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
