/**
 * `amp runtime inspect` — read persisted typed runtime semantic entities (RUNTIME-18).
 *
 * Falsifiable claim: typed rows loaded via RuntimeStoreSemanticEntityReader are
 * reported with parse/validation status without mutating storage or parsing DB rows in CLI.
 *
 * Boundary ownership:
 * - runtime-inspect (this module): CLI orchestration and reporting.
 * - RuntimeStoreSemanticEntityReader: storage read boundary.
 * - safeParseRuntimeSemanticEntityRecordFromUnknown: envelope + semantic validation.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { projectConfigPath } from "../config/paths.js";
import type { RuntimeSemanticEntityRecord } from "../runtime-semantics/entity-record.js";
import {
  safeParseRuntimeSemanticEntityRecordFromUnknown,
  type RuntimeSemanticEntityRecordParseFailureReason,
} from "../runtime-semantics/entity-record-parse.js";
import {
  RUNTIME_ENTITY_REGISTRY,
  type RuntimeEntityKind,
  type RuntimeEntitySchemaName,
  isRuntimeEntityKind,
  runtimeEntitySchemaNameForKind,
} from "../runtime-semantics/schema.js";
import {
  RuntimeStoreSemanticEntityReader,
  type RuntimeSemanticEntityReader,
} from "../runtime-semantics/storage-source.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";

export interface AmpRuntimeInspectOptions {
  projectRoot?: string;
  entity?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  deps?: {
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
    createReader?: (runtime: RuntimeStore) => RuntimeSemanticEntityReader;
  };
}

export interface AmpRuntimeInspectRecordEntry {
  id: string;
  kind: string;
  scope: string;
  project_ref?: string;
  observed_at?: string;
  payload: unknown;
  ok: boolean;
  reason?: RuntimeSemanticEntityRecordParseFailureReason;
  message?: string;
}

export interface AmpRuntimeInspectResult {
  projectRoot: string;
  runtimeDbPath?: string;
  entity?: RuntimeEntityKind;
  entitySchemaName?: RuntimeEntitySchemaName;
  storageWired: boolean;
  ok: boolean;
  error?: string;
  records: AmpRuntimeInspectRecordEntry[];
}

function toInspectRecordEntry(
  record: RuntimeSemanticEntityRecord,
): AmpRuntimeInspectRecordEntry {
  const parseResult = safeParseRuntimeSemanticEntityRecordFromUnknown(record);
  if (parseResult.ok) {
    return {
      id: record.id,
      kind: record.kind,
      scope: record.scope,
      ...(record.project_ref ? { project_ref: record.project_ref } : {}),
      ...(record.observed_at ? { observed_at: record.observed_at } : {}),
      payload: record.payload,
      ok: true,
    };
  }

  return {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    ...(record.project_ref ? { project_ref: record.project_ref } : {}),
    ...(record.observed_at ? { observed_at: record.observed_at } : {}),
    payload: record.payload,
    ok: false,
    reason: parseResult.reason,
    message: parseResult.message,
  };
}

/** Read persisted typed runtime semantic entities and report parse/validation status. */
export function runAmpRuntimeInspect(
  options: AmpRuntimeInspectOptions = {},
): AmpRuntimeInspectResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  let entity: RuntimeEntityKind | undefined;
  if (options.entity !== undefined) {
    if (!isRuntimeEntityKind(options.entity)) {
      const expected = RUNTIME_ENTITY_REGISTRY.map((entry) => entry.kind).join(", ");
      return {
        projectRoot,
        storageWired: false,
        ok: false,
        error: `Invalid runtime entity kind "${options.entity}" — expected one of: ${expected}.`,
        records: [],
      };
    }
    entity = options.entity;
  }

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      storageWired: false,
      ok: false,
      error: `Project AMP config not found at ${configPath}. Run \`ai-memory amp init\` first.`,
      records: [],
    };
  }

  let runtimeDbPath: string;
  try {
    const context = resolveCliProjectContext({
      projectRoot,
      env,
      platform: options.platform,
      homedir: options.homedir,
    });
    runtimeDbPath = context.runtimeDbPath;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      projectRoot,
      storageWired: false,
      ok: false,
      error: `AMP config discovery failed: ${message}`,
      records: [],
    };
  }

  const openStore = options.deps?.openRuntimeStore ?? openRuntimeStore;
  const createReader =
    options.deps?.createReader ??
    ((runtime: RuntimeStore) => new RuntimeStoreSemanticEntityReader(runtime));

  const runtime = openStore(runtimeDbPath);
  let records: AmpRuntimeInspectRecordEntry[] = [];

  try {
    const persisted = createReader(runtime).readEntities();
    const filtered =
      entity === undefined
        ? persisted
        : persisted.filter((record) => record.kind === entity);

    records = filtered.map(toInspectRecordEntry);
  } finally {
    runtime.close();
  }

  return {
    projectRoot,
    runtimeDbPath,
    entity,
    entitySchemaName: entity ? runtimeEntitySchemaNameForKind(entity) : undefined,
    storageWired: true,
    ok: true,
    records,
  };
}

/** Human-readable runtime inspect report lines for CLI and tests. */
export function formatAmpRuntimeInspectReport(result: AmpRuntimeInspectResult): string[] {
  const lines = [
    `AMP runtime inspect (experimental operator command) — ${result.projectRoot}`,
    "",
  ];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push("ERROR Runtime inspect did not run.");
    return lines;
  }

  if (result.runtimeDbPath) {
    lines.push(`  runtime: ${result.runtimeDbPath}`);
  }

  if (result.entity) {
    lines.push(`  filter: ${result.entity} (${result.entitySchemaName})`);
  }

  lines.push("");

  if (result.records.length === 0) {
    lines.push("  (no persisted typed runtime semantic entities)");
  } else {
    for (const entry of result.records) {
      if (entry.ok) {
        lines.push(
          `  OK ${entry.id} (${entry.kind}, ${entry.scope})`,
        );
      } else {
        lines.push(
          `  SKIP ${entry.id} (${entry.kind}, ${entry.scope}): ${entry.reason} — ${entry.message}`,
        );
      }
    }
  }

  const validCount = result.records.filter((entry) => entry.ok).length;
  const skipCount = result.records.length - validCount;
  lines.push("");
  lines.push(`Summary: ${validCount} valid, ${skipCount} skipped`);

  lines.push("");
  lines.push("OK Runtime inspect finished read-only; no state was mutated.");

  return lines;
}

/** JSON payload for `amp runtime inspect --json`. */
export function formatAmpRuntimeInspectJson(result: AmpRuntimeInspectResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      runtimeDbPath: result.runtimeDbPath ?? null,
      entity: result.entity ?? null,
      entitySchemaName: result.entitySchemaName ?? null,
      storageWired: result.storageWired,
      error: result.error ?? null,
      records: result.records.map((entry) =>
        entry.ok
          ? {
              id: entry.id,
              kind: entry.kind,
              scope: entry.scope,
              project_ref: entry.project_ref ?? null,
              observed_at: entry.observed_at ?? null,
              payload: entry.payload,
              ok: true,
            }
          : {
              id: entry.id,
              kind: entry.kind,
              scope: entry.scope,
              project_ref: entry.project_ref ?? null,
              observed_at: entry.observed_at ?? null,
              payload: entry.payload,
              ok: false,
              reason: entry.reason ?? null,
              message: entry.message ?? null,
            }
      ),
    },
    null,
    2,
  );
}
