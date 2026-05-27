/**
 * Knowledge backend selection for AMP CLI consolidate/retrieve commands.
 *
 * Config schema has runtime only — backend is selected via CLI flags or
 * AMP_KNOWLEDGE_BACKEND env for v1.
 */

import { dirname, join } from "node:path";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import {
  LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE,
  LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
} from "../projection/messages.js";
import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import {
  assertLiveGbrainWriteConfirmed,
  type KnowledgeBackendAccess,
} from "../gbrain/live-policy.js";
import { resolveAmpRepoRoot } from "./doctor.js";

export const AMP_KNOWLEDGE_BACKEND_ENV = "AMP_KNOWLEDGE_BACKEND";

export type AmpKnowledgeBackend = "in-memory" | "gbrain" | "fake-gbrain";

const VALID_BACKENDS: AmpKnowledgeBackend[] = ["in-memory", "gbrain", "fake-gbrain"];

export interface ResolveKnowledgeBackendOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}

/** Resolve knowledge backend from CLI flag or AMP_KNOWLEDGE_BACKEND env. */
export function resolveKnowledgeBackend(
  options: ResolveKnowledgeBackendOptions = {}
): AmpKnowledgeBackend {
  const env = options.env ?? process.env;
  const candidate = options.explicit?.trim() || env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim();

  if (candidate) {
    if (!VALID_BACKENDS.includes(candidate as AmpKnowledgeBackend)) {
      throw new Error(
        `Invalid knowledge backend "${candidate}" — expected one of: ${VALID_BACKENDS.join(", ")}`
      );
    }
    return candidate as AmpKnowledgeBackend;
  }

  return "gbrain";
}

export interface KnowledgeBackendHandle {
  backend: AmpKnowledgeBackend;
  inMemory?: InMemoryKnowledgeStore;
  gbrain?: GbrainKnowledgeAdapter;
  /** True when live gbrain serve transport is in use (PROVISIONAL). */
  liveGbrain?: boolean;
}

export interface CreateKnowledgeBackendOptions {
  backend: AmpKnowledgeBackend;
  /** read: live gbrain allowed; write: requires live write confirmation unless adapter injected. */
  access?: KnowledgeBackendAccess;
  confirmLiveGbrainWrite?: boolean;
  env?: NodeJS.ProcessEnv;
  ampRepoRoot?: string;
  /** Inject in-memory store for tests (consolidate + retrieve in one process). */
  inMemoryStore?: InMemoryKnowledgeStore;
  /** Inject gbrain adapter for tests — bypasses live write confirmation. */
  gbrainAdapter?: GbrainKnowledgeAdapter;
}

/** Create or inject a knowledge backend handle for consolidate/retrieve. */
export function createKnowledgeBackend(
  options: CreateKnowledgeBackendOptions
): KnowledgeBackendHandle {
  if (options.backend === "in-memory") {
    return {
      backend: "in-memory",
      inMemory: options.inMemoryStore ?? new InMemoryKnowledgeStore(),
    };
  }

  if (options.gbrainAdapter) {
    return {
      backend: options.backend,
      gbrain: options.gbrainAdapter,
      liveGbrain: false,
    };
  }

  const ampRepoRoot = resolveAmpRepoRoot(options.ampRepoRoot);
  const ssaSpecPath = join(ampRepoRoot, "ssa-files", "gbrain.yaml");

  if (options.backend === "fake-gbrain") {
    return {
      backend: "fake-gbrain",
      gbrain: new GbrainKnowledgeAdapter({
        transport: new FakeGbrainMcpTransport(),
        ssaSpecPath,
      }),
      liveGbrain: false,
    };
  }

  const access = options.access ?? "read";
  if (access === "write") {
    assertLiveGbrainWriteConfirmed({
      confirmLiveGbrainWrite: options.confirmLiveGbrainWrite,
      env: options.env,
    });
  }

  return {
    backend: "gbrain",
    gbrain: new GbrainKnowledgeAdapter({
      ssaSpecPath,
      useLiveTransport: true,
    }),
    liveGbrain: true,
  };
}

/** Create a read-only knowledge backend handle (live gbrain reads allowed). */
export function createReadKnowledgeBackend(
  options: Omit<CreateKnowledgeBackendOptions, "access">
): KnowledgeBackendHandle {
  return createKnowledgeBackend({ ...options, access: "read" });
}

/** Create a mutating knowledge backend handle (live gbrain writes require confirmation). */
export function createWriteKnowledgeBackend(
  options: Omit<CreateKnowledgeBackendOptions, "access">
): KnowledgeBackendHandle {
  return createKnowledgeBackend({ ...options, access: "write" });
}

export interface ResolveProjectionKnowledgeStoreOptions {
  env?: NodeJS.ProcessEnv;
  knowledgeStore?: InMemoryKnowledgeStore;
}

export type ResolveProjectionKnowledgeStoreResult =
  | { ok: true; store: InMemoryKnowledgeStore }
  | { ok: false; error: string };

/** Resolve offline knowledge for local projection source — never live gbrain. */
export function resolveProjectionKnowledgeStore(
  options: ResolveProjectionKnowledgeStoreOptions = {}
): ResolveProjectionKnowledgeStoreResult {
  if (options.knowledgeStore) {
    return { ok: true, store: options.knowledgeStore };
  }

  const backend = resolveKnowledgeBackend({ env: options.env });
  if (backend !== "in-memory") {
    return { ok: false, error: LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE };
  }

  const handle = createReadKnowledgeBackend({
    backend: "in-memory",
    env: options.env,
  });

  if (!handle.inMemory) {
    return { ok: false, error: LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE };
  }

  return { ok: true, store: handle.inMemory };
}

export interface ResolveLocalPersistentProjectionKnowledgeStoreOptions {
  knowledgeStore?: KnowledgeStore;
  runtimeDbPath?: string;
}

export type ResolveLocalPersistentProjectionKnowledgeStoreResult =
  | { ok: true; store: KnowledgeStore; cleanup: () => void }
  | { ok: false; error: string };

export const GRADUATION_APPLY_KNOWLEDGE_NOT_PERSISTENT =
  "Graduation apply requires a persistent local knowledge backend; in-memory CLI apply is not durable.";

export type ResolveGraduationApplyKnowledgeStoreFailureReason =
  "knowledge_backend_not_persistent";

/** Resolve `knowledge.db` adjacent to the typed runtime store path. */
export function resolveLocalKnowledgeDbPath(runtimeDbPath: string): string {
  return join(dirname(runtimeDbPath), "knowledge.db");
}

function openLocalPersistentKnowledgeStore(
  runtimeDbPath: string,
): { store: KnowledgeStore; cleanup: () => void } {
  const store = new LocalSqliteKnowledgeStore({
    dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
  });
  return { store, cleanup: () => store.close() };
}

export type ResolveLocalPersistentKnowledgeStoreResult =
  | { ok: true; store: KnowledgeStore; cleanup: () => void }
  | { ok: false; error: string };

function resolveLocalPersistentKnowledgeStore(options: {
  knowledgeStore?: KnowledgeStore;
  runtimeDbPath?: string;
  unavailableError: string;
}): ResolveLocalPersistentKnowledgeStoreResult {
  if (options.knowledgeStore) {
    return { ok: true, store: options.knowledgeStore, cleanup: () => {} };
  }

  if (!options.runtimeDbPath) {
    return { ok: false, error: options.unavailableError };
  }

  const { store, cleanup } = openLocalPersistentKnowledgeStore(options.runtimeDbPath);
  return { ok: true, store, cleanup };
}

/** Resolve local projection knowledge from injected store or persistent knowledge.db (no gbrain). */
export function resolveLocalPersistentProjectionKnowledgeStore(
  options: ResolveLocalPersistentProjectionKnowledgeStoreOptions = {},
): ResolveLocalPersistentProjectionKnowledgeStoreResult {
  return resolveLocalPersistentKnowledgeStore({
    knowledgeStore: options.knowledgeStore,
    runtimeDbPath: options.runtimeDbPath,
    unavailableError: LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
  });
}

export const LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE =
  "Local retrieve knowledge is unavailable. Run `amp init` so retrieve can open persistent knowledge.db beside runtime storage.";

export interface ResolveLocalPersistentRetrieveKnowledgeStoreOptions {
  knowledgeStore?: KnowledgeStore;
  runtimeDbPath?: string;
}

export type ResolveLocalPersistentRetrieveKnowledgeStoreResult =
  ResolveLocalPersistentKnowledgeStoreResult;

/** Resolve retrieve knowledge from injected store or persistent knowledge.db (no gbrain). */
export function resolveLocalPersistentRetrieveKnowledgeStore(
  options: ResolveLocalPersistentRetrieveKnowledgeStoreOptions = {},
): ResolveLocalPersistentRetrieveKnowledgeStoreResult {
  return resolveLocalPersistentKnowledgeStore({
    knowledgeStore: options.knowledgeStore,
    runtimeDbPath: options.runtimeDbPath,
    unavailableError: LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE,
  });
}

export type AmpRetrieveKnowledgeBackend = AmpKnowledgeBackend | "local-persistent";

export interface ResolveRetrieveKnowledgeStoreOptions {
  explicitKnowledge?: string;
  env?: NodeJS.ProcessEnv;
  runtimeDbPath?: string;
  inMemoryStore?: InMemoryKnowledgeStore;
  knowledgeStore?: KnowledgeStore;
  gbrainAdapter?: GbrainKnowledgeAdapter;
  ampRepoRoot?: string;
}

export type ResolveRetrieveKnowledgeStoreResult =
  | {
      ok: true;
      backend: "in-memory";
      store: InMemoryKnowledgeStore;
      liveGbrain?: undefined;
      cleanup: () => void;
    }
  | {
      ok: true;
      backend: "gbrain" | "fake-gbrain";
      gbrain: GbrainKnowledgeAdapter;
      liveGbrain?: boolean;
      cleanup: () => void;
    }
  | {
      ok: true;
      backend: "local-persistent";
      store: KnowledgeStore;
      liveGbrain?: undefined;
      cleanup: () => void;
    }
  | { ok: false; error: string };

function hasExplicitRetrieveKnowledgeBackendSelection(
  options: Pick<ResolveRetrieveKnowledgeStoreOptions, "explicitKnowledge" | "env">,
): boolean {
  const env = options.env ?? process.env;
  return Boolean(options.explicitKnowledge?.trim() || env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim());
}

/**
 * Resolve retrieve knowledge backend and store handle.
 *
 * Precedence:
 * 1. Explicit `--knowledge` or `AMP_KNOWLEDGE_BACKEND` → in-memory, gbrain, or fake-gbrain
 * 2. Injected `inMemoryStore` (backward-compatible tests)
 * 3. Injected `knowledgeStore` or persistent local SQLite via `runtimeDbPath`
 */
export function resolveRetrieveKnowledgeStore(
  options: ResolveRetrieveKnowledgeStoreOptions = {},
): ResolveRetrieveKnowledgeStoreResult {
  const env = options.env ?? process.env;

  if (hasExplicitRetrieveKnowledgeBackendSelection(options)) {
    const backend = resolveKnowledgeBackend({ explicit: options.explicitKnowledge, env });
    const handle = createReadKnowledgeBackend({
      backend,
      ampRepoRoot: options.ampRepoRoot,
      inMemoryStore: options.inMemoryStore,
      gbrainAdapter: options.gbrainAdapter,
      env,
    });

    if (backend === "in-memory") {
      if (!handle.inMemory) {
        return { ok: false, error: LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE };
      }
      return {
        ok: true,
        backend: "in-memory",
        store: handle.inMemory,
        cleanup: () => {},
      };
    }

    if (!handle.gbrain) {
      return { ok: false, error: LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE };
    }

    return {
      ok: true,
      backend,
      gbrain: handle.gbrain,
      liveGbrain: handle.liveGbrain,
      cleanup: () => {},
    };
  }

  if (options.inMemoryStore) {
    return {
      ok: true,
      backend: "in-memory",
      store: options.inMemoryStore,
      cleanup: () => {},
    };
  }

  const resolved = resolveLocalPersistentRetrieveKnowledgeStore({
    knowledgeStore: options.knowledgeStore,
    runtimeDbPath: options.runtimeDbPath,
  });

  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    backend: "local-persistent",
    store: resolved.store,
    cleanup: resolved.cleanup,
  };
}

export interface ResolveGraduationApplyKnowledgeStoreOptions {
  knowledgeStore?: KnowledgeStore;
  runtimeDbPath?: string;
}

export type ResolveGraduationApplyKnowledgeStoreResult =
  | { ok: true; store: KnowledgeStore; cleanup: () => void }
  | {
      ok: false;
      reason: ResolveGraduationApplyKnowledgeStoreFailureReason;
      error: string;
    };

/** Resolve durable knowledge for graduation apply — injected store or local SQLite only (no gbrain). */
export function resolveGraduationApplyKnowledgeStore(
  options: ResolveGraduationApplyKnowledgeStoreOptions = {},
): ResolveGraduationApplyKnowledgeStoreResult {
  if (options.knowledgeStore) {
    return { ok: true, store: options.knowledgeStore, cleanup: () => {} };
  }

  const resolved = resolveLocalPersistentKnowledgeStore({
    runtimeDbPath: options.runtimeDbPath,
    unavailableError: GRADUATION_APPLY_KNOWLEDGE_NOT_PERSISTENT,
  });

  if (!resolved.ok) {
    return {
      ok: false,
      reason: "knowledge_backend_not_persistent",
      error: resolved.error,
    };
  }

  return resolved;
}
