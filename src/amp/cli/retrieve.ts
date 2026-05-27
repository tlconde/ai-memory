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
  resolveRetrieveKnowledgeStore,
  type AmpRetrieveKnowledgeBackend,
} from "./knowledge-backend.js";

export type { AmpRetrieveKnowledgeBackend };

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

  const resolved = resolveRetrieveKnowledgeStore({
    explicitKnowledge: options.knowledge,
    env: options.env,
    runtimeDbPath: context.runtimeDbPath,
    inMemoryStore: options.inMemoryStore,
    knowledgeStore: options.knowledgeStore,
    gbrainAdapter: options.gbrainAdapter,
    ampRepoRoot: options.ampRepoRoot,
  });

  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  let preferences: RetrievedPreference[];

  try {
    switch (resolved.backend) {
      case "gbrain":
      case "fake-gbrain":
        preferences = await retrievePreferencesFromGbrain(resolved.gbrain, {
          scope,
          projectRef,
          query: options.query,
        });
        break;
      case "in-memory":
      case "local-persistent":
        preferences = retrievePreferences(resolved.store, {
          scope,
          projectRef,
          query: options.query,
        });
        break;
    }
  } finally {
    resolved.cleanup();
  }

  return {
    projectRoot: context.projectRoot,
    knowledgeBackend: resolved.backend,
    liveGbrain: resolved.liveGbrain,
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
