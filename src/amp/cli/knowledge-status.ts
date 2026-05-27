/**
 * `amp knowledge status` — read-only operator status for local knowledge storage.
 *
 * Falsifiable claim: knowledge status reads frames from local knowledge.db
 * without writes and without consulting gbrain, regardless of AMP_KNOWLEDGE_BACKEND.
 */

import { existsSync } from "node:fs";

import type { Frame } from "../core/frame-schema.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import {
  resolveAmpRuntimeCliBootstrap,
  type AmpRuntimeCliBootstrapOptions,
} from "./runtime-cli-bootstrap.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";

export interface AmpKnowledgeStatusOptions extends AmpRuntimeCliBootstrapOptions {
  /** Inject knowledge store for testing (bypasses local SQLite open). */
  knowledgeStore?: { list(): Frame[]; close?: () => void };
  /** Override runtimeDbPath for testing. */
  runtimeDbPath?: string;
}

export interface AmpKnowledgeStatusResult {
  ok: boolean;
  projectRoot: string;
  runtimeDbPath: string;
  knowledgeDbPath: string;
  knowledgeDbExists: boolean;
  totalFrames: number;
  countsByKind: Record<string, number>;
  countsByScope: Record<string, number>;
  error?: string;
}

/** Read-only local knowledge status — always reads local SQLite, never gbrain. */
export function runAmpKnowledgeStatus(
  options: AmpKnowledgeStatusOptions = {},
): AmpKnowledgeStatusResult {
  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });

  if (!bootstrap.ok) {
    return {
      ok: false,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath: "",
      knowledgeDbPath: "",
      knowledgeDbExists: false,
      totalFrames: 0,
      countsByKind: {},
      countsByScope: {},
      error: bootstrap.error,
    };
  }

  const runtimeDbPath = options.runtimeDbPath ?? bootstrap.runtimeDbPath;
  const knowledgeDbPath = resolveLocalKnowledgeDbPath(runtimeDbPath);
  const knowledgeDbExists = existsSync(knowledgeDbPath);

  if (options.knowledgeStore) {
    const frames = options.knowledgeStore.list();
    return buildResult({
      ok: true,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath,
      knowledgeDbPath,
      knowledgeDbExists: true,
      frames,
    });
  }

  if (!knowledgeDbExists) {
    return {
      ok: true,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath,
      knowledgeDbPath,
      knowledgeDbExists: false,
      totalFrames: 0,
      countsByKind: {},
      countsByScope: {},
    };
  }

  const store = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
  try {
    const frames = store.list();
    return buildResult({
      ok: true,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath,
      knowledgeDbPath,
      knowledgeDbExists: true,
      frames,
    });
  } finally {
    store.close();
  }
}

function buildResult(ctx: {
  ok: true;
  projectRoot: string;
  runtimeDbPath: string;
  knowledgeDbPath: string;
  knowledgeDbExists: boolean;
  frames: Frame[];
}): AmpKnowledgeStatusResult {
  const countsByKind: Record<string, number> = {};
  const countsByScope: Record<string, number> = {};

  for (const frame of ctx.frames) {
    countsByKind[frame.kind] = (countsByKind[frame.kind] ?? 0) + 1;
    countsByScope[frame.scope.kind] = (countsByScope[frame.scope.kind] ?? 0) + 1;
  }

  return {
    ok: true,
    projectRoot: ctx.projectRoot,
    runtimeDbPath: ctx.runtimeDbPath,
    knowledgeDbPath: ctx.knowledgeDbPath,
    knowledgeDbExists: ctx.knowledgeDbExists,
    totalFrames: ctx.frames.length,
    countsByKind,
    countsByScope,
  };
}

/** Human-readable knowledge status report lines. */
export function formatAmpKnowledgeStatusReport(result: AmpKnowledgeStatusResult): string[] {
  if (!result.ok) {
    return [
      `AMP knowledge status — ${result.projectRoot}`,
      "",
      `  ERROR ${result.error}`,
      "",
      "ERROR Knowledge status could not be determined.",
    ];
  }

  const lines = [
    `AMP knowledge status — ${result.projectRoot}`,
    "",
    `  runtimeDbPath:    ${result.runtimeDbPath}`,
    `  knowledgeDbPath:  ${result.knowledgeDbPath}`,
    `  knowledgeDbExists: ${result.knowledgeDbExists}`,
    `  totalFrames:      ${result.totalFrames}`,
  ];

  if (Object.keys(result.countsByKind).length > 0) {
    lines.push("");
    lines.push("  Frames by kind:");
    for (const [kind, count] of Object.entries(result.countsByKind)) {
      lines.push(`    ${kind}: ${count}`);
    }
  }

  if (Object.keys(result.countsByScope).length > 0) {
    lines.push("");
    lines.push("  Frames by scope:");
    for (const [scope, count] of Object.entries(result.countsByScope)) {
      lines.push(`    ${scope}: ${count}`);
    }
  }

  lines.push("");
  lines.push("OK Local knowledge status complete.");
  return lines;
}

/** JSON payload for `amp knowledge status --json`. */
export function formatAmpKnowledgeStatusJson(result: AmpKnowledgeStatusResult): string {
  return JSON.stringify({ ...result, error: result.error ?? null }, null, 2);
}
