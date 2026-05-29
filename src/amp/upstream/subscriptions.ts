/**
 * Upstream subscription persistence (~/.amp/upstream/subscriptions.json).
 *
 * Falsifiable claim: subscriptions round-trip through Zod validation with strict
 * unknown-key rejection; default conflict policy is local-wins.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  defaultUpstreamSubscriptionsPath,
  type PathContext,
} from "../config/paths.js";
import {
  UpstreamConflictPolicySchema,
  UpstreamSourceKindSchema,
  type UpstreamConflictPolicy,
  type UpstreamSourceKind,
} from "./types.js";

export const UpstreamSubscriptionConfigSchema = z
  .object({
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
    poll: z.string().min(1).optional(),
    policy: UpstreamConflictPolicySchema.default("local-wins"),
  })
  .strict();

export type UpstreamSubscriptionConfig = z.infer<typeof UpstreamSubscriptionConfigSchema>;

export const UpstreamSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    kind: UpstreamSourceKindSchema,
    config: UpstreamSubscriptionConfigSchema,
  })
  .strict();

export type UpstreamSubscription = z.infer<typeof UpstreamSubscriptionSchema>;

export const UpstreamSubscriptionsFileSchema = z
  .object({
    subscriptions: z.array(UpstreamSubscriptionSchema).default([]),
  })
  .strict();

export type UpstreamSubscriptionsFile = z.infer<typeof UpstreamSubscriptionsFileSchema>;

export class UpstreamSubscriptionsError extends Error {
  override readonly name = "UpstreamSubscriptionsError";
}

function subscriptionsPath(options: PathContext = {}): string {
  return defaultUpstreamSubscriptionsPath(options);
}

/** Read subscriptions from disk; returns empty list when file is missing. */
export async function readUpstreamSubscriptions(
  options: PathContext = {}
): Promise<UpstreamSubscription[]> {
  const path = subscriptionsPath(options);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = UpstreamSubscriptionsFileSchema.parse(JSON.parse(raw));
    return parsed.subscriptions;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

/** Validate and write subscriptions file. */
export async function writeUpstreamSubscriptions(
  subscriptions: readonly UpstreamSubscription[],
  options: PathContext = {}
): Promise<void> {
  const path = subscriptionsPath(options);
  const validated = UpstreamSubscriptionsFileSchema.parse({ subscriptions: [...subscriptions] });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

/** Add or replace a subscription by id. */
export async function upsertUpstreamSubscription(
  subscription: UpstreamSubscription,
  options: PathContext = {}
): Promise<UpstreamSubscription[]> {
  const validated = UpstreamSubscriptionSchema.parse(subscription);
  const existing = await readUpstreamSubscriptions(options);
  const next = existing.filter((entry) => entry.id !== validated.id);
  next.push(validated);
  await writeUpstreamSubscriptions(next, options);
  return next;
}

/** Remove a subscription by id. */
export async function removeUpstreamSubscription(
  id: string,
  options: PathContext = {}
): Promise<UpstreamSubscription[]> {
  const existing = await readUpstreamSubscriptions(options);
  const next = existing.filter((entry) => entry.id !== id);
  if (next.length === existing.length) {
    throw new UpstreamSubscriptionsError(`Subscription not found: ${id}`);
  }
  await writeUpstreamSubscriptions(next, options);
  return next;
}

/** Resolve subscription conflict policy with local-wins default. */
export function resolveSubscriptionPolicy(
  subscription: UpstreamSubscription
): UpstreamConflictPolicy {
  return subscription.config.policy ?? "local-wins";
}

/** Derive a stable subscription id from a URL (stub-friendly). */
export function deriveSubscriptionId(url: string, kind: UpstreamSourceKind): string {
  const normalized = url.replace(/^stub:/, "").replace(/[/\\]+$/, "");
  const slug = normalized
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? `${kind}-${slug}` : kind;
}
