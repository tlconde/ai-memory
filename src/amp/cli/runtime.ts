/**
 * `amp runtime status|inspect|correct` — runtime semantics CLI stubs (RUNTIME-03).
 *
 * Falsifiable claim: status lists supported entity schemas; inspect validates entity
 * kinds read-only; correct records intent but refuses durable mutation until wired.
 */

import { resolve } from "node:path";

import {
  RUNTIME_ENTITY_REGISTRY,
  RUNTIME_ENTITY_SCHEMA_NAMES,
  type RuntimeEntityKind,
  isRuntimeEntityKind,
  runtimeEntitySchemaNameForKind,
} from "../runtime-semantics/schema.js";

export const RUNTIME_STORAGE_NOT_WIRED =
  "Runtime semantics storage and wiring are not implemented yet.";

export const RUNTIME_INSPECT_NOT_WIRED =
  "Runtime inspect requires future storage wiring; no entities were read.";

export const RUNTIME_CORRECT_NOT_WIRED =
  "Runtime correction is not wired yet; no durable state was mutated.";

export interface AmpRuntimeStatusResult {
  ok: true;
  schemas: readonly string[];
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
  lines.push("OK Runtime semantics schemas are available; use `amp runtime inspect` once storage is wired.");

  return lines;
}

export interface AmpRuntimeInspectOptions {
  projectRoot?: string;
  entity?: string;
}

export interface AmpRuntimeInspectResult {
  projectRoot: string;
  entity?: RuntimeEntityKind;
  entitySchemaName?: string;
  storageWired: false;
  ok: boolean;
  error?: string;
}

/** Read-only runtime inspect stub; validates entity kind without storage access. */
export function runAmpRuntimeInspect(
  options: AmpRuntimeInspectOptions = {}
): AmpRuntimeInspectResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());

  if (options.entity !== undefined && !isRuntimeEntityKind(options.entity)) {
    const expected = RUNTIME_ENTITY_REGISTRY.map((entry) => entry.kind).join(", ");
    return {
      projectRoot,
      storageWired: false,
      ok: false,
      error: `Invalid runtime entity kind "${options.entity}" — expected one of: ${expected}.`,
    };
  }

  const entity = options.entity as RuntimeEntityKind | undefined;

  return {
    projectRoot,
    entity,
    entitySchemaName: entity ? runtimeEntitySchemaNameForKind(entity) : undefined,
    storageWired: false,
    ok: true,
  };
}

/** Human-readable runtime inspect report lines for CLI and tests. */
export function formatAmpRuntimeInspectReport(result: AmpRuntimeInspectResult): string[] {
  const lines = [`AMP runtime inspect — ${result.projectRoot}`, ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push("ERROR Runtime inspect did not run.");
    return lines;
  }

  if (result.entity) {
    lines.push(`  entity: ${result.entity} (${result.entitySchemaName})`);
    lines.push("");
  }

  lines.push(`  NOTE ${RUNTIME_INSPECT_NOT_WIRED}`);
  lines.push("");
  lines.push("OK Runtime inspect stub finished read-only; no state was mutated.");

  return lines;
}

/** JSON payload for `amp runtime inspect --json`. */
export function formatAmpRuntimeInspectJson(result: AmpRuntimeInspectResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      entity: result.entity ?? null,
      entitySchemaName: result.entitySchemaName ?? null,
      storageWired: result.storageWired,
      error: result.error ?? null,
      message: result.ok ? RUNTIME_INSPECT_NOT_WIRED : null,
    },
    null,
    2
  );
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
