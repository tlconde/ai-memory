/**
 * `amp upstream` — subscription, poll, review, apply, dismiss (AMP §16.6).
 */

import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  AMP_USER_UPSTREAM_PATH_ENV,
  defaultUserUpstreamDir,
  type PathContext,
} from "../config/paths.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { applyChangeset } from "../upstream/apply.js";
import { listChangesets, readChangeset, updateChangesetStatus } from "../upstream/changesets.js";
import {
  deriveSubscriptionId,
  readUpstreamSubscriptions,
  removeUpstreamSubscription,
  upsertUpstreamSubscription,
  type UpstreamSubscription,
} from "../upstream/subscriptions.js";
import {
  isStubUpstreamUrl,
  resolveStubFixtureDir,
  StubUpstreamSource,
} from "../upstream/stub-source.js";
import { runUpstreamSync } from "../upstream/sync.js";
import type { UpstreamSource, UpstreamSourceKind } from "../upstream/types.js";
import {
  createPropagationHarnessWriters,
  loadProcedureRegistryFromDirectory,
  defaultProjectProceduresDir,
} from "./propagate.js";
import { resolveCliProjectContext } from "./cli-context.js";

export interface AmpUpstreamPathOptions extends PathContext {
  upstreamDir?: string;
}

function resolveUpstreamPathContext(options: AmpUpstreamPathOptions = {}): PathContext {
  if (options.upstreamDir) {
    return {
      env: {
        ...(options.env ?? process.env),
        [AMP_USER_UPSTREAM_PATH_ENV]: options.upstreamDir,
      },
      platform: options.platform,
      homedir: options.homedir,
    };
  }
  return options;
}

function inferKindFromUrl(url: string): UpstreamSourceKind {
  if (url.startsWith("stub:")) {
    return "registry-url";
  }
  if (url.endsWith(".json") || url.includes("mcp")) {
    return "mcp-tools-manifest";
  }
  return "git-repo";
}

export function createUpstreamSourceFromSubscription(
  subscription: UpstreamSubscription,
  registry: ProcedureRegistry
): UpstreamSource {
  if (!isStubUpstreamUrl(subscription.config.url)) {
    throw new Error(
      `Only stub upstream sources are supported in this release: ${subscription.config.url}`
    );
  }

  return new StubUpstreamSource({
    id: subscription.id,
    kind: subscription.kind,
    config: subscription.config,
    fixtureDir: resolveStubFixtureDir(subscription.config.url),
    registry,
    localRef: subscription.config.ref ?? "local-fixture",
  });
}

export interface AmpUpstreamSubscribeOptions extends AmpUpstreamPathOptions {
  url: string;
  ref?: string;
  poll?: string;
  policy?: "local-wins" | "upstream-wins" | "prompt";
  id?: string;
}

export async function runAmpUpstreamSubscribe(options: AmpUpstreamSubscribeOptions) {
  const pathContext = resolveUpstreamPathContext(options);
  const kind = inferKindFromUrl(options.url);
  const id = options.id ?? deriveSubscriptionId(options.url, kind);
  const subscription = await upsertUpstreamSubscription(
    {
      id,
      kind,
      config: {
        url: options.url,
        ref: options.ref,
        poll: options.poll,
        policy: options.policy ?? "local-wins",
      },
    },
    pathContext
  );
  return { ok: true as const, id, subscriptions: subscription };
}

export interface AmpUpstreamUnsubscribeOptions extends AmpUpstreamPathOptions {
  id: string;
}

export async function runAmpUpstreamUnsubscribe(options: AmpUpstreamUnsubscribeOptions) {
  const pathContext = resolveUpstreamPathContext(options);
  const subscriptions = await removeUpstreamSubscription(options.id, pathContext);
  return { ok: true as const, subscriptions };
}

export async function runAmpUpstreamList(options: AmpUpstreamPathOptions = {}) {
  const pathContext = resolveUpstreamPathContext(options);
  const [subscriptions, changesets] = await Promise.all([
    readUpstreamSubscriptions(pathContext),
    listChangesets(pathContext),
  ]);
  return { ok: true as const, subscriptions, changesets };
}

export interface AmpUpstreamReviewOptions extends AmpUpstreamPathOptions {
  id: string;
  json?: boolean;
}

export async function runAmpUpstreamReview(options: AmpUpstreamReviewOptions) {
  const pathContext = resolveUpstreamPathContext(options);
  const changeset = await readChangeset(options.id, pathContext);
  if (!changeset) {
    return { ok: false as const, error: `Changeset not found: ${options.id}` };
  }
  return { ok: true as const, changeset };
}

export interface AmpUpstreamPollOptions extends AmpUpstreamPathOptions {
  projectRoot?: string;
  registry?: ProcedureRegistry;
}

export async function runAmpUpstreamPoll(options: AmpUpstreamPollOptions = {}) {
  const pathContext = resolveUpstreamPathContext(options);
  const subscriptions = await readUpstreamSubscriptions(pathContext);
  if (subscriptions.length === 0) {
    return { ok: true as const, results: [], silent: true };
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const registry =
    options.registry ??
    (await loadProcedureRegistryFromDirectory(defaultProjectProceduresDir(projectRoot)));

  const sources = subscriptions.map((subscription) =>
    createUpstreamSourceFromSubscription(subscription, registry)
  );

  const results = await runUpstreamSync({
    ...pathContext,
    sources,
    registry,
  });

  return { ok: true as const, results, silent: results.every((entry) => !entry.driftDetected) };
}

export interface AmpUpstreamApplyOptions extends AmpUpstreamPathOptions {
  changesetId: string;
  projectRoot?: string;
  registry?: ProcedureRegistry;
  only?: string[];
  exclude?: string[];
  confirmBreaking?: boolean;
  acceptUpstream?: string[];
  runtimeDbPath?: string;
}

export async function runAmpUpstreamApply(options: AmpUpstreamApplyOptions) {
  const pathContext = resolveUpstreamPathContext(options);
  const changeset = await readChangeset(options.changesetId, pathContext);
  if (!changeset) {
    return {
      ok: false as const,
      error: `Changeset not found: ${options.changesetId}`,
    };
  }

  const subscriptions = await readUpstreamSubscriptions(pathContext);
  const subscription = subscriptions.find((entry) => entry.id === changeset.sourceId);
  if (!subscription) {
    return {
      ok: false as const,
      error: `No subscription for source ${changeset.sourceId}`,
    };
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  let projectRef: string | undefined;
  try {
    projectRef = resolveCliProjectContext({ projectRoot, env: options.env }).projectRef;
  } catch {
    projectRef = undefined;
  }

  const registry =
    options.registry ??
    (await loadProcedureRegistryFromDirectory(defaultProjectProceduresDir(projectRoot)));

  const source = createUpstreamSourceFromSubscription(subscription, registry);
  const writers = createPropagationHarnessWriters(projectRoot);

  let runtime: RuntimeStore | undefined;
  if (options.runtimeDbPath) {
    runtime = new RuntimeStore({ dbPath: options.runtimeDbPath });
  }

  try {
    const result = await applyChangeset({
      ...pathContext,
      changesetId: options.changesetId,
      registry,
      source,
      writers,
      runtime,
      only: options.only,
      exclude: options.exclude,
      confirmBreaking: options.confirmBreaking,
      acceptUpstream: options.acceptUpstream,
      projectRef,
    });

    return { ok: result.ok, result, error: result.error };
  } finally {
    runtime?.close();
  }
}

export interface AmpUpstreamDismissOptions extends AmpUpstreamPathOptions {
  id: string;
}

export async function runAmpUpstreamDismiss(options: AmpUpstreamDismissOptions) {
  const pathContext = resolveUpstreamPathContext(options);
  const changeset = await readChangeset(options.id, pathContext);
  if (!changeset) {
    return { ok: false as const, error: `Changeset not found: ${options.id}` };
  }
  await updateChangesetStatus(options.id, "dismissed", new Date().toISOString(), pathContext);
  return { ok: true as const, id: options.id };
}

export function formatAmpUpstreamListReport(result: Awaited<ReturnType<typeof runAmpUpstreamList>>): string[] {
  if (!result.ok) {
    return ["upstream list failed"];
  }
  const lines = ["Upstream subscriptions:"];
  if (result.subscriptions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const subscription of result.subscriptions) {
      lines.push(`  - ${subscription.id} (${subscription.kind}) → ${subscription.config.url}`);
    }
  }
  lines.push("", "Changesets:");
  if (result.changesets.length === 0) {
    lines.push("  (none)");
  } else {
    for (const changeset of result.changesets) {
      lines.push(`  - ${changeset.id} [${changeset.status}] risk=${changeset.riskClass}`);
    }
  }
  return lines;
}

export function formatAmpUpstreamPollReport(result: Awaited<ReturnType<typeof runAmpUpstreamPoll>>): string[] {
  if (!result.ok) {
    return ["upstream poll failed"];
  }
  if (result.silent) {
    return [];
  }
  return result.results
    .filter((entry) => entry.driftDetected)
    .map((entry) => `Drift detected: ${entry.sourceId} → changeset ${entry.changesetId}`);
}

export function formatAmpUpstreamApplyReport(
  result: Awaited<ReturnType<typeof runAmpUpstreamApply>>
): string[] {
  if (result.result) {
    const lines = [
      `Applied ${result.result.applied.length} procedure(s): ${result.result.applied.join(", ") || "(none)"}`,
    ];
    if (result.result.skipped.length > 0) {
      lines.push(`Skipped: ${result.result.skipped.join(", ")}`);
    }
    if (!result.ok && result.error) {
      lines.push(`Error: ${result.error}`);
    }
    return lines;
  }
  return [result.error ?? "upstream apply failed"];
}

/** Ensure upstream dir exists for init-style flows. */
export async function ensureUserUpstreamDir(options: AmpUpstreamPathOptions = {}): Promise<string> {
  const pathContext = resolveUpstreamPathContext(options);
  const dir = defaultUserUpstreamDir(pathContext);
  await mkdir(join(dir, "changesets"), { recursive: true });
  return dir;
}
