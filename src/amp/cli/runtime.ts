/**
 * `amp runtime status|correct` — runtime semantics CLI (RUNTIME-03, RUNTIME-23).
 *
 * Falsifiable claim: status lists supported entity schemas; correct captures explicit
 * operator corrections into typed runtime semantic storage. Persisted entity inspect
 * lives in runtime-inspect.ts (RUNTIME-18).
 */

import { resolve } from "node:path";

import {
  createRuntimeSemanticCaptureFacade,
  type CaptureRuntimeCorrectionFailureReason,
  type RuntimeSemanticCaptureFacadeDeps,
} from "../runtime-semantics/capture-facade.js";
import {
  defaultExplicitCorrectionRecordId,
  deterministicCorrectionTimestamp,
  EXPLICIT_CORRECTION_CLI_PROVENANCE,
} from "../runtime-semantics/capture-correction-mapper.js";
import { RUNTIME_STATUS_LOCAL_STORAGE_NOTE } from "../runtime-semantics/messages.js";
import {
  RUNTIME_ENTITY_SCHEMA_NAMES,
  type RuntimeEntitySchemaName,
} from "../runtime-semantics/schema.js";
import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  resolveAmpRuntimeCliBootstrap,
  withAmpRuntimeCliStore,
} from "./runtime-cli-bootstrap.js";

export {
  RUNTIME_STATUS_LOCAL_STORAGE_NOTE,
} from "../runtime-semantics/messages.js";

export interface AmpRuntimeStatusResult {
  ok: true;
  schemas: readonly RuntimeEntitySchemaName[];
  localStorageWired: true;
}

/** Report runtime semantics feature status and supported entity schemas. */
export function runAmpRuntimeStatus(): AmpRuntimeStatusResult {
  return {
    ok: true,
    schemas: RUNTIME_ENTITY_SCHEMA_NAMES,
    localStorageWired: true,
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
  lines.push(`NOTE ${RUNTIME_STATUS_LOCAL_STORAGE_NOTE}`);
  lines.push(
    "OK Runtime semantics schemas are available; use `amp runtime inspect` to read persisted typed entities (experimental).",
  );

  return lines;
}

export interface AmpRuntimeCorrectOptions {
  projectRoot?: string;
  id: string;
  note: string;
  scope?: ScopeKind;
  projectRef?: string;
  recordId?: string;
  occurredAt?: string;
  recordedAt?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  deps?: {
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
    writeEntity?: RuntimeSemanticCaptureFacadeDeps["writeEntity"];
  };
}

export interface AmpRuntimeCorrectResult {
  projectRoot: string;
  id: string;
  note: string;
  recordId?: string;
  runtimeDbPath?: string;
  storageWired: boolean;
  ok: boolean;
  error?: string;
  reason?: CaptureRuntimeCorrectionFailureReason;
}

function defaultCorrectionTimestamps(options: {
  id: string;
  note: string;
  recordId: string;
  projectRef?: string;
}): { occurredAt: string; recordedAt: string } {
  const key = `${options.recordId}:${options.id}:${options.note}:${options.projectRef ?? ""}`;
  const occurredAt = deterministicCorrectionTimestamp(key);
  return { occurredAt, recordedAt: occurredAt };
}

/** Capture an explicit operator correction into typed runtime semantic storage. */
export function runAmpRuntimeCorrect(options: AmpRuntimeCorrectOptions): AmpRuntimeCorrectResult {
  const env = options.env ?? process.env;
  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env,
    platform: options.platform,
    homedir: options.homedir,
  });

  if (!bootstrap.ok) {
    return {
      projectRoot: bootstrap.projectRoot,
      id: options.id,
      note: options.note,
      storageWired: false,
      ok: false,
      error: bootstrap.error,
    };
  }

  const inferredScope: ScopeKind =
    options.scope ?? (bootstrap.projectRef ? "project" : "user");
  const projectRef = options.projectRef ?? bootstrap.projectRef;
  const recordId = options.recordId ?? defaultExplicitCorrectionRecordId(options.id);
  let occurredAt = options.occurredAt;
  let recordedAt = options.recordedAt;
  if (occurredAt === undefined && recordedAt === undefined) {
    const times = defaultCorrectionTimestamps({
      id: options.id,
      note: options.note,
      recordId,
      projectRef,
    });
    occurredAt = times.occurredAt;
    recordedAt = times.recordedAt;
  } else {
    occurredAt = occurredAt ?? recordedAt!;
    recordedAt = recordedAt ?? occurredAt;
  }

  const captureResult = withAmpRuntimeCliStore(
    bootstrap,
    { deps: { openRuntimeStore: options.deps?.openRuntimeStore } },
    (runtime) =>
      createRuntimeSemanticCaptureFacade(runtime, {
        writeEntity: options.deps?.writeEntity,
      }).captureExplicitCorrection({
        targetEntityId: options.id,
        recordId,
        note: options.note,
        scope: inferredScope,
        projectRef,
        occurredAt,
        recordedAt,
        provenance: EXPLICIT_CORRECTION_CLI_PROVENANCE,
      }),
  );

  if (!captureResult.ok) {
    return {
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath: bootstrap.runtimeDbPath,
      id: options.id,
      note: options.note,
      storageWired: true,
      ok: false,
      reason: captureResult.reason,
      error: captureResult.message,
    };
  }

  return {
    projectRoot: bootstrap.projectRoot,
    runtimeDbPath: bootstrap.runtimeDbPath,
    id: options.id,
    note: options.note,
    recordId: captureResult.recordId,
    storageWired: true,
    ok: true,
  };
}

/** Human-readable runtime correct report lines for CLI and tests. */
export function formatAmpRuntimeCorrectReport(result: AmpRuntimeCorrectResult): string[] {
  const lines = [
    `AMP runtime correct — ${result.projectRoot}`,
    "",
    `  id: ${result.id}`,
    `  note: ${result.note}`,
  ];

  if (result.recordId) {
    lines.push(`  record: ${result.recordId}`);
  }

  if (result.runtimeDbPath) {
    lines.push(`  runtime: ${result.runtimeDbPath}`);
  }

  lines.push("");

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push("ERROR Runtime correction did not complete.");
    return lines;
  }

  lines.push("OK Runtime correction captured in typed runtime semantic storage.");
  return lines;
}

/** JSON payload for `amp runtime correct --json`. */
export function formatAmpRuntimeCorrectJson(result: AmpRuntimeCorrectResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      runtimeDbPath: result.runtimeDbPath ?? null,
      id: result.id,
      note: result.note,
      recordId: result.recordId ?? null,
      storageWired: result.storageWired,
      reason: result.reason ?? null,
      error: result.error ?? null,
    },
    null,
    2,
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
