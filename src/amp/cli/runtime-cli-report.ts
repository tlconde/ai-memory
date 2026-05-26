/**
 * Shared runtime CLI report formatting helpers (RUNTIME-16/18).
 *
 * Mechanical line assembly only — command-specific copy stays in each command module.
 */

/** Append the standard runtime DB path line when storage is wired. */
export function appendRuntimeDbPathLine(
  lines: string[],
  runtimeDbPath: string | undefined,
): void {
  if (runtimeDbPath) {
    lines.push(`  runtime: ${runtimeDbPath}`);
  }
}

/** Append the standard runtime CLI error block and return lines for early exit. */
export function appendRuntimeCliErrorBlock(
  lines: string[],
  error: string,
  footerMessage: string,
): string[] {
  lines.push(`  ERROR ${error}`);
  lines.push("");
  lines.push(footerMessage);
  return lines;
}

/** Pretty-print runtime CLI JSON payloads. */
export function formatRuntimeCliJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
