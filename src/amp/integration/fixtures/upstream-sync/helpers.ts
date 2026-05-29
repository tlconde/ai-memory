/**
 * Helpers for upstream-sync integration fixtures.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AMP_USER_UPSTREAM_PATH_ENV } from "../../../config/paths.js";
import { createCanonicalProcedure, type CanonicalProcedure } from "../../../procedural/schema.js";
import { ProcedureRegistry } from "../../../procedural/registry.js";
import { procedureChecksum } from "../../../upstream/checksum.js";
import type { UpstreamManifest } from "../../../upstream/types.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  type V1FixtureProject,
} from "../v1-project.js";

export const UPSTREAM_TEST_SOURCE_ID = "stub-fixture-main";

export function createHarnessProcedure(name: string, body = "# Skill\n"): CanonicalProcedure {
  return createCanonicalProcedure({
    name,
    description: `Fixture procedure ${name}`,
    version: "0.1.0",
    triggers: [`/${name}`],
    harness_compatibility: {
      supported_harnesses: ["cursor", "claude-code", "hermes"],
      injection_path: "filesystem-native",
    },
    provenance: {
      source: "import",
      created_at: "2026-05-27T10:00:00.000Z",
      upstream: {
        source_id: UPSTREAM_TEST_SOURCE_ID,
        ref: "fixture-ref-v1",
        upstream_synced_at: "2026-05-27T10:00:00.000Z",
      },
    },
    body,
  });
}

export async function writeUpstreamFixture(
  fixtureRoot: string,
  options: {
    ref: string;
    procedures: CanonicalProcedure[];
    schemaChanges?: UpstreamManifest["schemaChanges"];
  }
): Promise<void> {
  const upstreamDir = join(fixtureRoot, "upstream");
  const proceduresDir = join(upstreamDir, "procedures");
  await mkdir(proceduresDir, { recursive: true });

  for (const procedure of options.procedures) {
    await writeFile(
      join(proceduresDir, `${procedure.frontmatter.name}.json`),
      `${JSON.stringify(procedure, null, 2)}\n`,
      "utf8"
    );
  }

  const manifest: UpstreamManifest = {
    sourceId: UPSTREAM_TEST_SOURCE_ID,
    fetchedAt: new Date().toISOString(),
    ref: options.ref,
    procedures: options.procedures.map((procedure) => ({
      id: procedure.frontmatter.name,
      version: procedure.frontmatter.version,
      checksum: procedureChecksum(procedure),
      updated_at:
        procedure.frontmatter.provenance?.updated_at ??
        procedure.frontmatter.provenance?.created_at ??
        "2026-05-27T10:00:00.000Z",
    })),
    ...(options.schemaChanges ? { schemaChanges: options.schemaChanges } : {}),
  };

  await writeFile(join(upstreamDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export interface UpstreamIntegrationEnv {
  fixture: V1FixtureProject;
  upstreamDir: string;
  fixtureRoot: string;
  registry: ProcedureRegistry;
  env: NodeJS.ProcessEnv;
}

export async function createUpstreamIntegrationEnv(
  fixtureRootName: string
): Promise<UpstreamIntegrationEnv> {
  const fixture = await createV1FixtureProject();
  const fixtureRoot = join(fixture.root, "upstream-fixtures", fixtureRootName);
  const upstreamDir = join(fixture.root, ".amp-user-upstream");
  await mkdir(fixtureRoot, { recursive: true });
  await mkdir(upstreamDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [AMP_USER_UPSTREAM_PATH_ENV]: upstreamDir,
  };

  return {
    fixture,
    upstreamDir,
    fixtureRoot,
    registry: new ProcedureRegistry(),
    env,
  };
}

export async function destroyUpstreamIntegrationEnv(env: UpstreamIntegrationEnv): Promise<void> {
  await destroyV1FixtureProject(env.fixture);
}

export function stubSubscriptionUrl(fixtureRoot: string): string {
  return `stub:${fixtureRoot}`;
}
