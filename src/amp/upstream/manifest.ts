/**
 * Build upstream manifests from a procedure registry.
 */

import type { ProcedureRegistry } from "../procedural/registry.js";
import type { UpstreamManifest } from "./types.js";
import { procedureChecksum } from "./checksum.js";

function procedureUpdatedAt(
  provenance: { created_at: string; updated_at?: string } | undefined
): string {
  return provenance?.updated_at ?? provenance?.created_at ?? new Date(0).toISOString();
}

/** Build a local upstream manifest snapshot from the in-memory registry. */
export function manifestFromRegistry(
  sourceId: string,
  registry: ProcedureRegistry,
  ref: string,
  fetchedAt: string = new Date().toISOString()
): UpstreamManifest {
  const procedures = registry.list().map((entry) => {
    const provenance = entry.procedure.frontmatter.provenance;
    return {
      id: entry.procedure.frontmatter.name,
      version: entry.procedure.frontmatter.version,
      checksum: procedureChecksum(entry.procedure),
      updated_at: procedureUpdatedAt(provenance),
    };
  });

  procedures.sort((left, right) => left.id.localeCompare(right.id));

  return {
    sourceId,
    fetchedAt,
    ref,
    procedures,
  };
}

/** Filter manifest procedures to those imported from a given upstream source. */
export function filterManifestProceduresForSource(
  manifest: UpstreamManifest,
  sourceId: string,
  registry: ProcedureRegistry
): UpstreamManifest {
  const importedIds = new Set(
    registry
      .list()
      .filter(
        (entry) => entry.procedure.frontmatter.provenance?.upstream?.source_id === sourceId
      )
      .map((entry) => entry.procedure.frontmatter.name)
  );

  return {
    ...manifest,
    procedures: manifest.procedures.filter((procedure) => importedIds.has(procedure.id)),
  };
}
