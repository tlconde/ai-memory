/**
 * Read-only gbrain skills discovery (AMP §10.4.2).
 *
 * Local-only: reads a user-supplied gbrain `skills/` directory via `--path`,
 * `GBRAIN_SKILLS_DIR`, or an explicit upstream subscription (`gbrain-skills`).
 * No network I/O and no writes into the skills tree.
 */

import type { PathContext } from "../config/paths.js";
import {
  GBRAIN_UPSTREAM_SOURCE_ID,
  mapGbrainToCanonicalProcedure,
} from "../procedural/parse-skill-md.js";
import type { ProceduralListEntry, ProceduralListResult } from "../procedural/list-types.js";
import {
  scanSkillMdDirectory,
  type SkillMdParseResult,
  type SkillMdScanEntry,
} from "../procedural/skill-md-scanner.js";
import {
  readUpstreamSubscriptions,
  type UpstreamSubscription,
} from "./subscriptions.js";
import { resolveStubFixtureDir, STUB_UPSTREAM_URL_PREFIX } from "./stub-source.js";

export { GBRAIN_UPSTREAM_SOURCE_ID };

export const GBRAIN_SKILLS_DIR_ENV = "GBRAIN_SKILLS_DIR";
export const GBRAIN_PROCEDURAL_SOURCE_ID = "gbrain";
export const GBRAIN_SKILLS_SUBSCRIPTION_ID = "gbrain-skills";
export const GBRAIN_SKILLS_FILE_URL_PREFIX = "file://";

export type GbrainSkillScanEntry = SkillMdScanEntry;

export type GbrainSkillParseResult = SkillMdParseResult;

export type ReadUpstreamSubscriptionsFn = (
  options?: PathContext
) => Promise<UpstreamSubscription[]>;

/** Resolve subscription `config.url` to a local skills directory (stub:, file://, or bare path). */
export function resolveGbrainSkillsUrlToDir(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith(STUB_UPSTREAM_URL_PREFIX)) {
    return resolveStubFixtureDir(trimmed);
  }
  if (trimmed.startsWith(GBRAIN_SKILLS_FILE_URL_PREFIX)) {
    return trimmed.slice(GBRAIN_SKILLS_FILE_URL_PREFIX.length);
  }
  if (trimmed.length > 0) {
    return trimmed;
  }
  throw new Error(`Invalid gbrain skills subscription url: ${url}`);
}

/** Read skills dir from subscription id `gbrain-skills` when present. */
export function skillsDirFromGbrainSubscription(
  subscriptions: readonly UpstreamSubscription[]
): string | undefined {
  const subscription = subscriptions.find((entry) => entry.id === GBRAIN_SKILLS_SUBSCRIPTION_ID);
  if (!subscription) {
    return undefined;
  }
  return resolveGbrainSkillsUrlToDir(subscription.config.url);
}

export function gbrainSkillsDirResolutionErrorMessage(): string {
  return (
    "Gbrain skills directory required. Use one of:\n" +
    "  --path <gbrain-skills-dir>\n" +
    `  ${GBRAIN_SKILLS_DIR_ENV}=<gbrain-skills-dir>\n` +
    `  amp upstream subscribe stub:<gbrain-skills-dir> --id ${GBRAIN_SKILLS_SUBSCRIPTION_ID}\n` +
    "(AMP does not guess install locations)."
  );
}

/**
 * Resolve gbrain skills directory:
 * `--path` > `GBRAIN_SKILLS_DIR` > subscription `gbrain-skills` > error.
 */
export async function resolveGbrainSkillsDir(options: {
  pathFlag?: string;
  env?: NodeJS.ProcessEnv;
  readSubscriptions?: ReadUpstreamSubscriptionsFn;
  pathContext?: PathContext;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const explicit = options.pathFlag?.trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = env[GBRAIN_SKILLS_DIR_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const readSubscriptions = options.readSubscriptions ?? readUpstreamSubscriptions;
  const subscriptions = await readSubscriptions(options.pathContext ?? { env });
  const fromSubscription = skillsDirFromGbrainSubscription(subscriptions);
  if (fromSubscription) {
    return fromSubscription;
  }

  throw new Error(gbrainSkillsDirResolutionErrorMessage());
}

/** Parse and map each gbrain SKILL.md under a skills directory. */
export async function parseGbrainSkillsDir(
  skillsDir: string,
  ref: string
): Promise<GbrainSkillParseResult[]> {
  return scanSkillMdDirectory(skillsDir, ref, mapGbrainToCanonicalProcedure);
}

export function gbrainParseResultsToListEntries(
  parsed: readonly GbrainSkillParseResult[]
): ProceduralListEntry[] {
  return parsed.map(
    (entry): ProceduralListEntry => ({
      name: entry.procedure?.frontmatter.name ?? entry.skillName,
      version: entry.procedure?.frontmatter.version ?? "unknown",
      supported_harnesses:
        entry.procedure?.frontmatter.harness_compatibility.supported_harnesses ?? [],
      validation_error: entry.validation_error,
      frontmatter: entry.procedure?.frontmatter,
    })
  );
}

/** Discovery list for `amp procedural list --source gbrain`. */
export async function listGbrainProcedures(options: {
  skillsDir: string;
  ref?: string;
}): Promise<ProceduralListResult> {
  const parsed = await parseGbrainSkillsDir(
    options.skillsDir,
    options.ref ?? "local-gbrain-skills"
  );
  return { entries: gbrainParseResultsToListEntries(parsed) };
}
