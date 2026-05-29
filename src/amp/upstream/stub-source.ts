/**
 * Fixture upstream source — reads a local directory; no network.
 *
 * Falsifiable claim: manifest(), pollUpstream(), and fetch() round-trip fixture
 * JSON without HTTP, git, or external I/O beyond the fixture directory.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { safeParseCanonicalProcedure, type CanonicalProcedure } from "../procedural/schema.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import { manifestFromRegistry } from "./manifest.js";
import {
  UpstreamManifestSchema,
  UpstreamPayloadSchema,
  type UpstreamManifest,
  type UpstreamPayload,
  type UpstreamSource,
  type UpstreamSourceConfig,
  type UpstreamSourceKind,
} from "./types.js";

export const STUB_UPSTREAM_URL_PREFIX = "stub:";

export interface StubUpstreamSourceOptions {
  id: string;
  kind?: UpstreamSourceKind;
  config: UpstreamSourceConfig;
  fixtureDir: string;
  registry: ProcedureRegistry;
  localRef?: string;
}

export class StubUpstreamSource implements UpstreamSource {
  readonly id: string;
  readonly kind: UpstreamSourceKind;
  readonly config: UpstreamSourceConfig;
  private readonly fixtureDir: string;
  private readonly registry: ProcedureRegistry;
  private readonly localRef: string;

  constructor(options: StubUpstreamSourceOptions) {
    this.id = options.id;
    this.kind = options.kind ?? "registry-url";
    this.config = options.config;
    this.fixtureDir = options.fixtureDir;
    this.registry = options.registry;
    this.localRef = options.localRef ?? "local-fixture";
  }

  async manifest(): Promise<UpstreamManifest> {
    return manifestFromRegistry(this.id, this.registry, this.localRef);
  }

  async pollUpstream(): Promise<UpstreamManifest> {
    const path = join(this.fixtureDir, "upstream", "manifest.json");
    const raw = await readFile(path, "utf8");
    const parsed = UpstreamManifestSchema.parse(JSON.parse(raw));
    if (parsed.sourceId !== this.id) {
      throw new Error(
        `Fixture manifest sourceId mismatch: expected ${this.id}, got ${parsed.sourceId}`
      );
    }
    return parsed;
  }

  async fetch(ref: string): Promise<UpstreamPayload> {
    const proceduresDir = join(this.fixtureDir, "upstream", "procedures");
    let files: string[];
    try {
      files = await readdir(proceduresDir);
    } catch {
      return UpstreamPayloadSchema.parse({ ref, procedures: {} });
    }

    const procedures: Record<string, CanonicalProcedure> = {};
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const raw = await readFile(join(proceduresDir, file), "utf8");
      const parsed = safeParseCanonicalProcedure(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(`Invalid fixture procedure ${file}: ${parsed.error}`);
      }
      procedures[parsed.procedure.frontmatter.name] = parsed.procedure;
    }

    return UpstreamPayloadSchema.parse({ ref, procedures });
  }
}

/** True when a subscription URL targets a local stub fixture. */
export function isStubUpstreamUrl(url: string): boolean {
  return url.startsWith(STUB_UPSTREAM_URL_PREFIX);
}

/** Resolve fixture directory from stub: URL. */
export function resolveStubFixtureDir(url: string): string {
  if (!isStubUpstreamUrl(url)) {
    throw new Error(`Not a stub upstream URL: ${url}`);
  }
  return url.slice(STUB_UPSTREAM_URL_PREFIX.length);
}
