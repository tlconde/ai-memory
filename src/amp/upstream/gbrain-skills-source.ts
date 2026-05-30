/**
 * Read-only gbrain skills discovery (AMP §10.4.2).
 *
 * Local-only: reads a user-supplied gbrain `skills/` directory via `--path`,
 * `GBRAIN_SKILLS_DIR`, or an explicit upstream subscription (`gbrain-skills`).
 * No network I/O and no writes into the skills tree.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { PathContext } from "../config/paths.js";
import {
  GBRAIN_UPSTREAM_SOURCE_ID,
  mapGbrainToCanonicalProcedure,
  parseSkillMd,
} from "../procedural/parse-skill-md.js";
import {
  ProcedureFrontmatterSchema,
  safeParseCanonicalProcedure,
  type CanonicalProcedure,
} from "../procedural/schema.js";
import {
  readUpstreamSubscriptions,
  type UpstreamSubscription,
} from "./subscriptions.js";
import { resolveStubFixtureDir, STUB_UPSTREAM_URL_PREFIX } from "./stub-source.js";
import type { GstackListEntry, GstackListResult } from "./gstack-import.js";

export { GBRAIN_UPSTREAM_SOURCE_ID };

export const GBRAIN_SKILLS_DIR_ENV = "GBRAIN_SKILLS_DIR";
export const GBRAIN_PROCEDURAL_SOURCE_ID = "gbrain";
export const GBRAIN_SKILLS_SUBSCRIPTION_ID = "gbrain-skills";
export const GBRAIN_SKILLS_FILE_URL_PREFIX = "file://";

export interface GbrainSkillScanEntry {
  skillName: string;
  skillPath: string;
  mtime: string;
}

export interface GbrainSkillParseResult {
  skillName: string;
  procedure?: CanonicalProcedure;
  validation_error?: string;
}

export type GbrainSkillsDirResolver = () => string | Promise<string>;

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

/** List gbrain-shaped skill directories under `<skillsDir>/<name>/SKILL.md`. */
export async function listGbrainSkillFiles(skillsDir: string): Promise<GbrainSkillScanEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }

  const results: GbrainSkillScanEntry[] = [];
  for (const entry of entries) {
    const skillPath = join(skillsDir, entry, "SKILL.md");
    try {
      const fileStat = await stat(skillPath);
      if (!fileStat.isFile()) {
        continue;
      }
      results.push({
        skillName: entry,
        skillPath,
        mtime: fileStat.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  results.sort((left, right) => left.skillName.localeCompare(right.skillName));
  return results;
}

/** Parse RESOLVER.md when present (routing table completeness; not required for discovery). */
export async function tryParseGbrainResolver(skillsDir: string): Promise<void> {
  const resolverPath = join(skillsDir, "RESOLVER.md");
  try {
    const fileStat = await stat(resolverPath);
    if (!fileStat.isFile()) {
      return;
    }
    const raw = await readFile(resolverPath, "utf8");
    parseSkillMd(raw);
  } catch {
    // RESOLVER is optional; invalid or missing files do not block discovery.
  }
}

/** Parse and map each gbrain SKILL.md under a skills directory. */
export async function parseGbrainSkillsDir(
  skillsDir: string,
  ref: string
): Promise<GbrainSkillParseResult[]> {
  await tryParseGbrainResolver(skillsDir);
  const skills = await listGbrainSkillFiles(skillsDir);
  const results: GbrainSkillParseResult[] = [];

  for (const skill of skills) {
    const raw = await readFile(skill.skillPath, "utf8");
    try {
      const parsed = parseSkillMd(raw);
      const mapped = mapGbrainToCanonicalProcedure(parsed, {
        ref,
        mtime: skill.mtime,
        skillDirName: skill.skillName,
      });
      const validated = safeParseCanonicalProcedure(mapped);
      if (!validated.success) {
        results.push({
          skillName: skill.skillName,
          validation_error: validated.error,
        });
        continue;
      }
      ProcedureFrontmatterSchema.parse(validated.procedure.frontmatter);
      results.push({ skillName: skill.skillName, procedure: validated.procedure });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ skillName: skill.skillName, validation_error: message });
    }
  }

  return results;
}

export class GbrainSkillsSource {
  readonly id = GBRAIN_UPSTREAM_SOURCE_ID;

  constructor(private readonly resolveSkillsDir: GbrainSkillsDirResolver | string) {}

  async resolveDir(): Promise<string> {
    if (typeof this.resolveSkillsDir === "string") {
      return this.resolveSkillsDir;
    }
    return this.resolveSkillsDir();
  }

  async list(ref = "local-gbrain-skills"): Promise<GbrainSkillParseResult[]> {
    const skillsDir = await this.resolveDir();
    return parseGbrainSkillsDir(skillsDir, ref);
  }
}

export function gbrainParseResultsToListEntries(
  parsed: readonly GbrainSkillParseResult[]
): GstackListEntry[] {
  return parsed.map(
    (entry): GstackListEntry => ({
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
}): Promise<GstackListResult> {
  const parsed = await parseGbrainSkillsDir(
    options.skillsDir,
    options.ref ?? "local-gbrain-skills"
  );
  return { entries: gbrainParseResultsToListEntries(parsed) };
}
