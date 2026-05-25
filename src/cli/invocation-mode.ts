import { lstatSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

export type CliInvocationMode = "amp-direct" | "ai-memory";

const AMP_BIN_NAMES = new Set(["amp"]);
const AI_MEMORY_BIN_NAMES = new Set(["ai-memory"]);

/** Resolve how the shared CLI entry was invoked (amp vs ai-memory). */
export function resolveCliInvocationMode(argv: string[]): CliInvocationMode {
  const scriptArg = argv[1];
  if (!scriptArg) {
    return "ai-memory";
  }

  const binName = resolveInvokingBinName(scriptArg);
  if (AMP_BIN_NAMES.has(binName)) {
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

function resolveInvokingBinName(scriptPath: string): string {
  const normalized = normalizeBinBasename(basename(scriptPath));

  try {
    if (lstatSync(scriptPath).isSymbolicLink()) {
      return normalized;
    }
  } catch {
    // Fall through to basename-based detection.
  }

  if (AMP_BIN_NAMES.has(normalized) || AI_MEMORY_BIN_NAMES.has(normalized)) {
    return normalized;
  }

  return normalized;
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
