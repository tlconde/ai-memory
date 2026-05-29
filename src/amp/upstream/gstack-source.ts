/**
 * Local-first gstack upstream source (AMP §11.4 / §9.9).
 *
 * Intentional spec deviation (§9.9.1): reads a user-provided local gstack checkout
 * via `file://<path>` — no git transport, GitHub access, or network I/O.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  mapGstackToCanonicalProcedure,
  parseSkillMd,
  GSTACK_UPSTREAM_SOURCE_ID,
} from "../procedural/parse-skill-md.js";
import {
  ProcedureFrontmatterSchema,
  safeParseCanonicalProcedure,
  type CanonicalProcedure,
} from "../procedural/schema.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import { filterManifestProceduresForSource, manifestFromRegistry } from "./manifest.js";
import { procedureChecksum } from "./checksum.js";
import {
  UpstreamManifestSchema,
  UpstreamPayloadSchema,
  type UpstreamManifest,
  type UpstreamPayload,
  type UpstreamSource,
  type UpstreamSourceConfig,
} from "./types.js";

export const GSTACK_FILE_URL_PREFIX = "file://";

export interface GstackUpstreamSourceOptions {
  id?: string;
  config: UpstreamSourceConfig;
  checkoutDir: string;
  registry: ProcedureRegistry;
  localRef?: string;
}

export interface GstackSkillScanEntry {
  skillName: string;
  skillPath: string;
  mtime: string;
}

export interface GstackSkillParseResult {
  skillName: string;
  procedure?: CanonicalProcedure;
  validation_error?: string;
}

/** Resolve a local gstack checkout directory from a file:// subscription URL. */
export function resolveGstackCheckoutDir(url: string): string {
  if (!url.startsWith(GSTACK_FILE_URL_PREFIX)) {
    throw new Error(`Gstack upstream URL must start with ${GSTACK_FILE_URL_PREFIX}: ${url}`);
  }
  return url.slice(GSTACK_FILE_URL_PREFIX.length);
}

/** Build a file:// URL for a local gstack checkout directory. */
export function gstackCheckoutUrl(checkoutDir: string): string {
  return `${GSTACK_FILE_URL_PREFIX}${checkoutDir}`;
}

/** True when a subscription URL targets a local gstack checkout. */
export function isGstackCheckoutUrl(url: string): boolean {
  return url.startsWith(GSTACK_FILE_URL_PREFIX);
}

/** List gstack-shaped skill directories under checkout/skills/<name>/SKILL.md. */
export async function listGstackSkillFiles(checkoutDir: string): Promise<GstackSkillScanEntry[]> {
  const skillsRoot = join(checkoutDir, "skills");
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch {
    return [];
  }

  const results: GstackSkillScanEntry[] = [];
  for (const entry of entries) {
    const skillPath = join(skillsRoot, entry, "SKILL.md");
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

/** Parse and map each gstack SKILL.md under a checkout directory. */
export async function parseGstackCheckoutSkills(
  checkoutDir: string,
  ref: string
): Promise<GstackSkillParseResult[]> {
  const skills = await listGstackSkillFiles(checkoutDir);
  const results: GstackSkillParseResult[] = [];

  for (const skill of skills) {
    const raw = await readFile(skill.skillPath, "utf8");
    try {
      const parsed = parseSkillMd(raw);
      const mapped = mapGstackToCanonicalProcedure(parsed, {
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

async function buildUpstreamManifestFromCheckout(
  sourceId: string,
  checkoutDir: string,
  ref: string
): Promise<UpstreamManifest> {
  const parsed = await parseGstackCheckoutSkills(checkoutDir, ref);
  const procedures = parsed
    .filter((entry): entry is GstackSkillParseResult & { procedure: CanonicalProcedure } =>
      entry.procedure !== undefined
    )
    .map((entry) => ({
      id: entry.procedure.frontmatter.name,
      version: entry.procedure.frontmatter.version,
      checksum: procedureChecksum(entry.procedure),
      updated_at:
        entry.procedure.frontmatter.provenance?.updated_at ??
        entry.procedure.frontmatter.provenance?.created_at ??
        new Date(0).toISOString(),
    }));

  return UpstreamManifestSchema.parse({
    sourceId,
    fetchedAt: new Date().toISOString(),
    ref,
    procedures,
  });
}

export class GstackUpstreamSource implements UpstreamSource {
  readonly id: string;
  readonly kind = "git-repo" as const;
  readonly config: UpstreamSourceConfig;
  private readonly checkoutDir: string;
  private readonly registry: ProcedureRegistry;
  private readonly localRef: string;

  constructor(options: GstackUpstreamSourceOptions) {
    this.id = options.id ?? GSTACK_UPSTREAM_SOURCE_ID;
    this.config = options.config;
    this.checkoutDir = options.checkoutDir;
    this.registry = options.registry;
    this.localRef = options.localRef ?? options.config.ref ?? "local-gstack";
  }

  async manifest(): Promise<UpstreamManifest> {
    const snapshot = manifestFromRegistry(this.id, this.registry, this.localRef);
    return filterManifestProceduresForSource(snapshot, this.id, this.registry);
  }

  async pollUpstream(): Promise<UpstreamManifest> {
    const ref = this.config.ref ?? this.localRef;
    return buildUpstreamManifestFromCheckout(this.id, this.checkoutDir, ref);
  }

  async fetch(ref: string): Promise<UpstreamPayload> {
    const parsed = await parseGstackCheckoutSkills(this.checkoutDir, ref);
    const procedures: Record<string, CanonicalProcedure> = {};

    for (const entry of parsed) {
      if (entry.procedure) {
        procedures[entry.procedure.frontmatter.name] = entry.procedure;
      }
    }

    return UpstreamPayloadSchema.parse({ ref, procedures });
  }
}
