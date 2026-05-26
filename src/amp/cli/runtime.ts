/**
 * `amp runtime status|correct` — runtime semantics CLI (RUNTIME-03).
 *
 * Falsifiable claim: status lists supported entity schemas; correct records intent
 * but refuses durable mutation until wired. Persisted entity inspect lives in
 * runtime-inspect.ts (RUNTIME-18).
 */

import { resolve } from "node:path";

import {
  RUNTIME_CORRECT_NOT_WIRED,
  RUNTIME_STORAGE_NOT_WIRED,
} from "../runtime-semantics/messages.js";
import {
  RUNTIME_ENTITY_SCHEMA_NAMES,
  type RuntimeEntitySchemaName,
} from "../runtime-semantics/schema.js";

export {
  RUNTIME_CORRECT_NOT_WIRED,
  RUNTIME_STORAGE_NOT_WIRED,
} from "../runtime-semantics/messages.js";

export interface AmpRuntimeStatusResult {
  ok: true;
  schemas: readonly RuntimeEntitySchemaName[];
  storageWired: false;
}

/** Report runtime semantics feature status and supported entity schemas. */
export function runAmpRuntimeStatus(): AmpRuntimeStatusResult {
  return {
    ok: true,
    schemas: RUNTIME_ENTITY_SCHEMA_NAMES,
    storageWired: false,
  };
}

/** Human-readable runtime status report lines for CLI and tests. */
export function formatAmpRuntimeStatusReport(result: AmpRuntimeStatusResult): string[] {
  const lines = [
    "AMP runtime semantics status",
    "",
    "Supported entity schemas:",
  ];

  for (const schemaName of result.schemas) {
    lines.push(`  - ${schemaName}`);
  }

  lines.push("");
  lines.push(`NOTE ${RUNTIME_STORAGE_NOT_WIRED}`);
  lines.push(
    "OK Runtime semantics schemas are available; use `amp runtime inspect` to read persisted typed entities (experimental).",
  );

  return lines;
}

export interface AmpRuntimeCorrectOptions {
  projectRoot?: string;
  id: string;
  note: string;
}

export interface AmpRuntimeCorrectResult {
  projectRoot: string;
  id: string;
  note: string;
  storageWired: false;
  ok: false;
  error: string;
}

/** Explicit correction stub; records intent but refuses durable mutation until wired. */
export function runAmpRuntimeCorrect(
  options: AmpRuntimeCorrectOptions
): AmpRuntimeCorrectResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());

  return {
    projectRoot,
    id: options.id,
    note: options.note,
    storageWired: false,
    ok: false,
    error: RUNTIME_CORRECT_NOT_WIRED,
  };
}

/** Human-readable runtime correct report lines for CLI and tests. */
export function formatAmpRuntimeCorrectReport(result: AmpRuntimeCorrectResult): string[] {
  return [
    `AMP runtime correct — ${result.projectRoot}`,
    "",
    `  id: ${result.id}`,
    `  note: ${result.note}`,
    "",
    `  ERROR ${result.error}`,
    "",
    "ERROR Runtime correction is not available yet; no state was mutated.",
  ];
}

/** JSON payload for `amp runtime correct --json`. */
export function formatAmpRuntimeCorrectJson(result: AmpRuntimeCorrectResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      id: result.id,
      note: result.note,
      storageWired: result.storageWired,
      error: result.error,
    },
    null,
    2
  );
}

export interface WriteAmpRuntimeCliResultOptions<T> {
  result: T;
  json?: boolean;
  formatJson: (result: T) => string;
  formatReport: (result: T) => string[];
}

/** Write runtime CLI output as JSON or human-readable report lines. */
export function writeAmpRuntimeCliResult<T>(options: WriteAmpRuntimeCliResultOptions<T>): void {
  if (options.json) {
    process.stdout.write(`${options.formatJson(options.result)}\n`);
    return;
  }

  for (const line of options.formatReport(options.result)) {
    process.stdout.write(`${line}\n`);
  }
}
