/**
 * `amp retrieve` — read consolidated preferences from the knowledge backend.
 *
 * Falsifiable claim: retrieve delegates storage-specific preference semantics to
 * substrate retrieval functions.
 */

import type { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import type { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import type { ScopeKind } from "../core/frame-schema.js";
import { LIVE_GBRAIN_READ_WARNING } from "../gbrain/live-policy.js";
import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import {
  retrievePreferences,
  retrievePreferencesFromGbrain,
  type RetrievedPreference,
} from "../substrate/retrieve-preference.js";
import { resolveCliProjectContext } from "./cli-context.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createReadKnowledgeBackend,
  resolveKnowledgeBackend,
  resolveLocalPersistentRetrieveKnowledgeStore,
  type AmpKnowledgeBackend,
} from "./knowledge-backend.js";

export type AmpRetrieveKnowledgeBackend = AmpKnowledgeBackend | "local-persistent";

export interface AmpRetrieveOptions {
  scope?: ScopeKind;
  projectRef?: string;
  query?: string;
  projectRoot?: string;
  knowledge?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  ampRepoRoot?: string;
  inMemoryStore?: InMemoryKnowledgeStore;
  knowledgeStore?: KnowledgeStore;
  gbrainAdapter?: GbrainKnowledgeAdapter;
}

export interface AmpRetrieveResult {
  projectRoot: string;
  knowledgeBackend: AmpRetrieveKnowledgeBackend;
  liveGbrain?: boolean;
  scope: ScopeKind;
  projectRef?: string;
  query?: string;
  preferences: RetrievedPreference[];
}

function hasExplicitKnowledgeBackendSelection(
  options: Pick<AmpRetrieveOptions, "knowledge" | "env">,
): boolean {
  const env = options.env ?? process.env;
  return Boolean(options.knowledge?.trim() || env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim());
}

function resolveExplicitKnowledgeBackend(
  options: Pick<AmpRetrieveOptions, "knowledge" | "env">,
): AmpKnowledgeBackend | undefined {
  if (!hasExplicitKnowledgeBackendSelection(options)) {
    return undefined;
  }
  return resolveKnowledgeBackend({ explicit: options.knowledge, env: options.env });
}

/** Retrieve consolidated preferences from knowledge storage. */
export async function runAmpRetrieve(
  options: AmpRetrieveOptions = {}
): Promise<AmpRetrieveResult> {
  const context = resolveCliProjectContext({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });

  const scope = options.scope ?? "project";
  const projectRef =
    scope === "project" ? (options.projectRef ?? context.projectRef) : options.projectRef;

  const explicitBackend = resolveExplicitKnowledgeBackend(options);
  let preferences: RetrievedPreference[];
  let knowledgeBackend: AmpRetrieveKnowledgeBackend;
  let liveGbrain: boolean | undefined;

  if (options.inMemoryStore || explicitBackend === "in-memory") {
    const handle = createReadKnowledgeBackend({
      backend: "in-memory",
      ampRepoRoot: options.ampRepoRoot,
      inMemoryStore: options.inMemoryStore,
      env: options.env,
    });
    knowledgeBackend = handle.backend;
    preferences = retrievePreferences(handle.inMemory!, {
      scope,
      projectRef,
      query: options.query,
    });
  } else if (explicitBackend === "gbrain" || explicitBackend === "fake-gbrain") {
    const handle = createReadKnowledgeBackend({
      backend: explicitBackend,
      ampRepoRoot: options.ampRepoRoot,
      gbrainAdapter: options.gbrainAdapter,
      env: options.env,
    });
    knowledgeBackend = handle.backend;
    liveGbrain = handle.liveGbrain;
    preferences = await retrievePreferencesFromGbrain(handle.gbrain!, {
      scope,
      projectRef,
      query: options.query,
    });
  } else {
    const resolved = resolveLocalPersistentRetrieveKnowledgeStore({
      knowledgeStore: options.knowledgeStore,
      runtimeDbPath: context.runtimeDbPath,
    });
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    knowledgeBackend = "local-persistent";
    try {
      preferences = retrievePreferences(resolved.store, {
        scope,
        projectRef,
        query: options.query,
      });
    } finally {
      resolved.cleanup();
    }
  }

  return {
    projectRoot: context.projectRoot,
    knowledgeBackend,
    liveGbrain,
    scope,
    projectRef,
    query: options.query,
    preferences,
  };
}

/** Human-readable retrieve output lines for CLI and tests. */
export function formatAmpRetrieveMessages(result: AmpRetrieveResult): string[] {
  const backendLabel =
    result.knowledgeBackend === "local-persistent"
      ? "local persistent knowledge.db"
      : result.knowledgeBackend;
  const lines = [
    `Retrieved ${result.preferences.length} preference(s) from ${backendLabel}.`,
    `  scope: ${result.scope}${result.projectRef ? ` (${result.projectRef})` : ""}`,
  ];

  if (result.liveGbrain) {
    lines.push(`  ${LIVE_GBRAIN_READ_WARNING}`);
  }

  if (result.preferences.length === 0) {
    lines.push("  (no matches)");
  } else {
    for (const item of result.preferences) {
      const content =
        typeof item.frame.content === "string"
          ? item.frame.content
          : JSON.stringify(item.frame.content);
      lines.push(`  - ${item.frame.id}: ${content}`);
    }
  }

  return lines;
}
