import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

/** Env var set by `amp-entry.js` before loading the shared CLI bootstrap. */
export const AMP_CLI_INVOCATION_ENV = "AMP_CLI_INVOCATION";

/** Value of {@link AMP_CLI_INVOCATION_ENV} for direct `amp` binary invocation. */
export const AMP_CLI_INVOCATION_DIRECT = "amp-direct";

export type CliInvocationMode = "amp-direct" | "ai-memory";

/** Resolve how the shared CLI entry was invoked (amp vs ai-memory). */
export function resolveCliInvocationMode(argv: string[]): CliInvocationMode {
  if (process.env[AMP_CLI_INVOCATION_ENV] === AMP_CLI_INVOCATION_DIRECT) {
    return "amp-direct";
  }

  const scriptArg = argv[1];
  if (!scriptArg) {
    return "ai-memory";
  }

  if (normalizeBinBasename(basename(scriptArg)) === "amp") {
    return "amp-direct";
  }

  return "ai-memory";
}

/** True when argv[1] resolves to the CLI entry module (direct execution or npm bin symlink). */
export function isCliEntryInvocation(argv1: string, entryPath: string): boolean {
  try {
    return resolve(realpathSync(argv1)) === resolve(realpathSync(entryPath));
  } catch {
    return resolve(argv1) === resolve(entryPath);
  }
}

function normalizeBinBasename(name: string): string {
  if (name.endsWith(".cmd")) {
    return name.slice(0, -4);
  }
  if (name.endsWith(".exe")) {
    return name.slice(0, -4);
  }
  return name;
}
