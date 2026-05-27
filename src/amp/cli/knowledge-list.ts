/**
 * `amp knowledge list` — read-only operator listing for local knowledge storage.
 *
 * Falsifiable claim: knowledge list reads frames from local knowledge.db without
 * writes and without consulting gbrain, regardless of AMP_KNOWLEDGE_BACKEND.
 */

import { existsSync } from "node:fs";

import type { Frame, FrameKind, ScopeKind } from "../core/frame-schema.js";
import { FrameKindSchema, ScopeKindSchema } from "../core/frame-schema.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import type { KnowledgeListFilter } from "../substrate/storage/knowledge-store.js";
import {
  resolveAmpRuntimeCliBootstrap,
  type AmpRuntimeCliBootstrapOptions,
} from "./runtime-cli-bootstrap.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";

export const DEFAULT_KNOWLEDGE_LIST_LIMIT = 20;
export const KNOWLEDGE_LIST_CONTENT_PREVIEW_MAX = 80;

export interface AmpKnowledgeListOptions extends AmpRuntimeCliBootstrapOptions {
  kind?: string;
  scope?: string;
  limit?: string | number;
  /** Inject knowledge store for testing (bypasses local SQLite open). */
  knowledgeStore?: { list(filter?: KnowledgeListFilter): Frame[]; close?: () => void };
  /** Override runtimeDbPath for testing. */
  runtimeDbPath?: string;
}

export interface AmpKnowledgeListFilters {
  kind?: FrameKind;
  scope?: ScopeKind;
  limit: number;
}

export interface AmpKnowledgeListItem {
  id: string;
  kind: FrameKind;
  scope: ScopeKind;
  projectRef?: string;
  createdAt: string;
  contentPreview: string;
}

export interface AmpKnowledgeListResult {
  ok: boolean;
  projectRoot: string;
  runtimeDbPath: string;
  knowledgeDbPath: string;
  knowledgeDbExists: boolean;
  filters: AmpKnowledgeListFilters;
  totalReturned: number;
  items: AmpKnowledgeListItem[];
  error?: string;
}

export type ParseKnowledgeListLimitResult =
  | { ok: true; limit: number }
  | { ok: false; error: string };

/** Parse optional --limit; default to DEFAULT_KNOWLEDGE_LIST_LIMIT. */
export function parseKnowledgeListLimit(rawLimit?: string | number): ParseKnowledgeListLimitResult {
  if (rawLimit === undefined || rawLimit === "") {
    return { ok: true, limit: DEFAULT_KNOWLEDGE_LIST_LIMIT };
  }

  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      ok: false,
      error: `Invalid knowledge list limit "${rawLimit}" — expected a positive integer.`,
    };
  }

  return { ok: true, limit: parsed };
}

function parseKnowledgeListKind(rawKind?: string): { ok: true; kind?: FrameKind } | { ok: false; error: string } {
  if (rawKind === undefined) {
    return { ok: true };
  }

  const parsed = FrameKindSchema.safeParse(rawKind);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid frame kind "${rawKind}" — expected one of: ${FrameKindSchema.options.join(", ")}.`,
    };
  }

  return { ok: true, kind: parsed.data };
}

function parseKnowledgeListScope(
  rawScope?: string,
): { ok: true; scope?: ScopeKind } | { ok: false; error: string } {
  if (rawScope === undefined) {
    return { ok: true };
  }

  const parsed = ScopeKindSchema.safeParse(rawScope);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid scope kind "${rawScope}" — expected one of: ${ScopeKindSchema.options.join(", ")}.`,
    };
  }

  return { ok: true, scope: parsed.data };
}

/** Build a safe, truncated content preview for operator output. */
export function previewKnowledgeFrameContent(
  content: Frame["content"],
  maxLength = KNOWLEDGE_LIST_CONTENT_PREVIEW_MAX,
): string {
  const text =
    typeof content === "string"
      ? content.replace(/\s+/g, " ").trim()
      : JSON.stringify(content);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function toListItem(frame: Frame): AmpKnowledgeListItem {
  return {
    id: frame.id,
    kind: frame.kind,
    scope: frame.scope.kind,
    ...(frame.scope.project_ref ? { projectRef: frame.scope.project_ref } : {}),
    createdAt: frame.created_at,
    contentPreview: previewKnowledgeFrameContent(frame.content),
  };
}

function emptyKnowledgeListResult(
  partial: Pick<AmpKnowledgeListResult, "ok" | "projectRoot" | "runtimeDbPath" | "knowledgeDbPath" | "filters"> &
    Partial<Pick<AmpKnowledgeListResult, "knowledgeDbExists" | "error">>,
): AmpKnowledgeListResult {
  return {
    knowledgeDbExists: false,
    totalReturned: 0,
    items: [],
    ...partial,
  };
}

/** Read-only local knowledge list — always reads local SQLite, never gbrain. */
export function runAmpKnowledgeList(options: AmpKnowledgeListOptions = {}): AmpKnowledgeListResult {
  const limitResult = parseKnowledgeListLimit(options.limit);
  if (!limitResult.ok) {
    return emptyKnowledgeListResult({
      ok: false,
      projectRoot: options.projectRoot ?? process.cwd(),
      runtimeDbPath: "",
      knowledgeDbPath: "",
      filters: { limit: DEFAULT_KNOWLEDGE_LIST_LIMIT },
      error: limitResult.error,
    });
  }

  const kindResult = parseKnowledgeListKind(options.kind);
  if (!kindResult.ok) {
    return emptyKnowledgeListResult({
      ok: false,
      projectRoot: options.projectRoot ?? process.cwd(),
      runtimeDbPath: "",
      knowledgeDbPath: "",
      filters: { limit: limitResult.limit },
      error: kindResult.error,
    });
  }

  const scopeResult = parseKnowledgeListScope(options.scope);
  if (!scopeResult.ok) {
    return emptyKnowledgeListResult({
      ok: false,
      projectRoot: options.projectRoot ?? process.cwd(),
      runtimeDbPath: "",
      knowledgeDbPath: "",
      filters: { limit: limitResult.limit, ...(kindResult.kind ? { kind: kindResult.kind } : {}) },
      error: scopeResult.error,
    });
  }

  const filters: AmpKnowledgeListFilters = {
    limit: limitResult.limit,
    ...(kindResult.kind ? { kind: kindResult.kind } : {}),
    ...(scopeResult.scope ? { scope: scopeResult.scope } : {}),
  };

  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });

  if (!bootstrap.ok) {
    return emptyKnowledgeListResult({
      ok: false,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath: "",
      knowledgeDbPath: "",
      filters,
      error: bootstrap.error,
    });
  }

  const runtimeDbPath = options.runtimeDbPath ?? bootstrap.runtimeDbPath;
  const knowledgeDbPath = resolveLocalKnowledgeDbPath(runtimeDbPath);
  const knowledgeDbExists = existsSync(knowledgeDbPath);

  if (!knowledgeDbExists && !options.knowledgeStore) {
    return emptyKnowledgeListResult({
      ok: true,
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath,
      knowledgeDbPath,
      knowledgeDbExists: false,
      filters,
    });
  }

  const listFilter: KnowledgeListFilter | undefined = filters.scope
    ? { scopeKind: filters.scope }
    : undefined;

  let frames: Frame[];
  if (options.knowledgeStore) {
    frames = options.knowledgeStore.list(listFilter);
  } else {
    const store = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      frames = store.list(listFilter);
    } finally {
      store.close();
    }
  }

  const filtered = filters.kind ? frames.filter((frame) => frame.kind === filters.kind) : frames;
  const limited = filtered.slice(0, filters.limit);
  const items = limited.map(toListItem);

  return {
    ok: true,
    projectRoot: bootstrap.projectRoot,
    runtimeDbPath,
    knowledgeDbPath,
    knowledgeDbExists: options.knowledgeStore ? true : knowledgeDbExists,
    filters,
    totalReturned: items.length,
    items,
  };
}

/** Human-readable knowledge list report lines. */
export function formatAmpKnowledgeListReport(result: AmpKnowledgeListResult): string[] {
  if (!result.ok) {
    return [
      `AMP knowledge list — ${result.projectRoot}`,
      "",
      `  ERROR ${result.error}`,
      "",
      "ERROR Knowledge list could not be determined.",
    ];
  }

  const filterParts = [`limit=${result.filters.limit}`];
  if (result.filters.kind) {
    filterParts.push(`kind=${result.filters.kind}`);
  }
  if (result.filters.scope) {
    filterParts.push(`scope=${result.filters.scope}`);
  }

  const lines = [
    `AMP knowledge list — ${result.projectRoot}`,
    "",
    `  runtimeDbPath:    ${result.runtimeDbPath}`,
    `  knowledgeDbPath:  ${result.knowledgeDbPath}`,
    `  knowledgeDbExists: ${result.knowledgeDbExists}`,
    `  filters: ${filterParts.join(", ")}`,
    `  totalReturned: ${result.totalReturned}`,
  ];

  if (result.items.length === 0) {
    lines.push("");
    lines.push("  (no frames)");
  } else {
    lines.push("");
    for (const item of result.items) {
      const scopeLabel = item.projectRef ? `${item.scope} (${item.projectRef})` : item.scope;
      lines.push(
        `  - ${item.id} | ${item.kind} | ${scopeLabel} | ${item.createdAt} | ${item.contentPreview}`,
      );
    }
  }

  lines.push("");
  lines.push("OK Local knowledge list complete.");
  return lines;
}

/** JSON payload for `amp knowledge list --json`. */
export function formatAmpKnowledgeListJson(result: AmpKnowledgeListResult): string {
  return JSON.stringify({ ...result, error: result.error ?? null }, null, 2);
}
