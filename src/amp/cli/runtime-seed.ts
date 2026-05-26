/**
 * `amp runtime seed` — operator CLI for typed runtime semantic entities (RUNTIME-16).
 *
 * Falsifiable claim: file-based JSON records persist through the validated writer
 * and round-trip into default local projection without capture/consolidation.
 *
 * Boundary ownership:
 * - runtime-seed (this module): file parse, batch orchestration, result reporting.
 * - writeRuntimeSemanticEntity: validation + persistence gate.
 * - projection render source: read + materialize seeded entities.
 */

import { existsSync } from "node:fs";
import { readFile as fsReadFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectConfigPath } from "../config/paths.js";
import type { RuntimeSemanticEntityRecordParseFailureReason } from "../runtime-semantics/entity-record-parse.js";
import {
  runtimeSemanticEntityRecordIdFromUnknown,
  safeParseRuntimeSemanticEntityRecordFromUnknown,
} from "../runtime-semantics/entity-record-parse.js";
import type { RuntimeSemanticEntityWriteFailureReason } from "../runtime-semantics/storage-validation.js";
import { writeRuntimeSemanticEntity } from "../runtime-semantics/storage-writer.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import type { RuntimeSemanticEntityRecord } from "../runtime-semantics/entity-record.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";

export type AmpRuntimeSeedRecordFailureReason =
  | RuntimeSemanticEntityRecordParseFailureReason
  | Extract<RuntimeSemanticEntityWriteFailureReason, "duplicate_id">;

export type AmpRuntimeSeedItemResult =
  | { id: string; ok: true }
  | { id: string; ok: false; reason: AmpRuntimeSeedRecordFailureReason; message: string };

export interface AmpRuntimeSeedOptions {
  projectRoot?: string;
  file: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  deps?: {
    readFile?: (path: string) => Promise<string>;
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
    writeEntity?: (
      runtime: RuntimeStore,
      record: RuntimeSemanticEntityRecord,
    ) => ReturnType<typeof writeRuntimeSemanticEntity>;
  };
}

export interface AmpRuntimeSeedResult {
  projectRoot: string;
  runtimeDbPath: string;
  file: string;
  results: AmpRuntimeSeedItemResult[];
  ok: boolean;
  error?: string;
}

function parseSeedRecordsFromJson(
  parsed: unknown,
): { ok: true; records: unknown[] } | { ok: false; error: string } {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { ok: false, error: "Seed file array is empty." };
    }
    return { ok: true, records: parsed };
  }

  if (typeof parsed === "object" && parsed !== null) {
    return { ok: true, records: [parsed] };
  }

  return {
    ok: false,
    error: "Seed file must contain a runtime semantic entity object or an array of entities.",
  };
}

/** Parse seed file JSON into runtime semantic entity record candidates. */
export function parseAmpRuntimeSeedFileContent(
  raw: string,
): { ok: true; records: unknown[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `Seed file is not valid JSON: ${message}` };
  }

  return parseSeedRecordsFromJson(parsed);
}

/** Seed typed runtime semantic entities from a JSON file through the validated writer. */
export async function runAmpRuntimeSeed(
  options: AmpRuntimeSeedOptions,
): Promise<AmpRuntimeSeedResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const file = resolve(options.file);
  const env = options.env ?? process.env;
  const readFile = options.deps?.readFile ?? ((path: string) => fsReadFile(path, "utf8"));
  const openStore = options.deps?.openRuntimeStore ?? openRuntimeStore;
  const writeEntity = options.deps?.writeEntity ?? writeRuntimeSemanticEntity;

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      runtimeDbPath: "",
      file,
      results: [],
      ok: false,
      error: `Project AMP config not found at ${configPath}. Run \`ai-memory amp init\` first.`,
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
      runtimeDbPath: "",
      file,
      results: [],
      ok: false,
      error: `AMP config discovery failed: ${message}`,
    };
  }

  let raw: string;
  try {
    raw = await readFile(file);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      projectRoot,
      runtimeDbPath,
      file,
      results: [],
      ok: false,
      error: `Failed to read seed file ${file}: ${message}`,
    };
  }

  const parsed = parseAmpRuntimeSeedFileContent(raw);
  if (!parsed.ok) {
    return {
      projectRoot,
      runtimeDbPath,
      file,
      results: [],
      ok: false,
      error: parsed.error,
    };
  }

  const runtime = openStore(runtimeDbPath);
  const results: AmpRuntimeSeedItemResult[] = [];

  try {
    for (const [index, candidate] of parsed.records.entries()) {
      const parseResult = safeParseRuntimeSemanticEntityRecordFromUnknown(candidate);
      if (!parseResult.ok) {
        results.push({
          id:
            parseResult.id ??
            runtimeSemanticEntityRecordIdFromUnknown(candidate, index),
          ok: false,
          reason: parseResult.reason,
          message: parseResult.message,
        });
        continue;
      }

      const writeResult = writeEntity(runtime, parseResult.record);
      if (writeResult.ok) {
        results.push({ id: parseResult.record.id, ok: true });
      } else {
        results.push({
          id: parseResult.record.id,
          ok: false,
          reason: writeResult.reason,
          message: writeResult.message,
        });
      }
    }
  } finally {
    runtime.close();
  }

  return {
    projectRoot,
    runtimeDbPath,
    file,
    results,
    ok: results.every((entry) => entry.ok),
  };
}

/** Human-readable runtime seed report lines for CLI and tests. */
export function formatAmpRuntimeSeedReport(result: AmpRuntimeSeedResult): string[] {
  const lines = [
    `AMP runtime seed (experimental operator command) — ${result.projectRoot}`,
    "",
    `  file: ${result.file}`,
  ];

  if (result.runtimeDbPath) {
    lines.push(`  runtime: ${result.runtimeDbPath}`);
  }

  lines.push("");

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push("ERROR Runtime seed did not complete.");
    return lines;
  }

  for (const entry of result.results) {
    if (entry.ok) {
      lines.push(`  OK ${entry.id}`);
    } else {
      lines.push(`  ERROR ${entry.id}: ${entry.reason} — ${entry.message}`);
    }
  }

  const succeeded = result.results.filter((entry) => entry.ok).length;
  const failed = result.results.length - succeeded;
  lines.push("");
  lines.push(`Summary: ${succeeded} succeeded, ${failed} failed`);

  if (result.ok) {
    lines.push("OK Runtime seed finished.");
  } else {
    lines.push("ERROR Runtime seed finished with failures.");
  }

  return lines;
}

/** JSON payload for `amp runtime seed --json`. */
export function formatAmpRuntimeSeedJson(result: AmpRuntimeSeedResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      runtimeDbPath: result.runtimeDbPath || null,
      file: result.file,
      error: result.error ?? null,
      results: result.results.map((entry) =>
        entry.ok
          ? { id: entry.id, ok: true }
          : { id: entry.id, ok: false, reason: entry.reason, message: entry.message }
      ),
    },
    null,
    2,
  );
}
