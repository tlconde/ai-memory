/**
 * Upstream sync orchestration — invokable poll without scheduler (AMP §16.3).
 */

import type { PathContext } from "../config/paths.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import {
  formatChangesetId,
  hasExistingChangesetForRefPair,
  latestDismissedUpstreamRef,
  writeChangeset,
} from "./changesets.js";
import { diffManifests } from "./diff.js";
import type { UpstreamSource, UpstreamSyncResult } from "./types.js";

export interface RunUpstreamSyncOptions extends PathContext {
  sources: readonly UpstreamSource[];
  registry: ProcedureRegistry;
  detectedAt?: Date;
}

/** Poll each subscribed source, emit changesets when drift is detected. */
export async function runUpstreamSync(
  options: RunUpstreamSyncOptions
): Promise<UpstreamSyncResult[]> {
  const detectedAt = options.detectedAt ?? new Date();
  const results: UpstreamSyncResult[] = [];

  for (const source of options.sources) {
    const local = await source.manifest();
    const upstream = await source.pollUpstream();

    const localChecksums = local.procedures
      .map((entry) => `${entry.id}:${entry.checksum}`)
      .sort()
      .join("|");
    const upstreamChecksums = upstream.procedures
      .map((entry) => `${entry.id}:${entry.checksum}`)
      .sort()
      .join("|");
    const schemaUnchanged = (upstream.schemaChanges ?? []).length === 0;

    if (local.ref === upstream.ref && localChecksums === upstreamChecksums && schemaUnchanged) {
      results.push({ sourceId: source.id, driftDetected: false });
      continue;
    }

    const dismissedRef = await latestDismissedUpstreamRef(source.id, options);
    if (dismissedRef === upstream.ref) {
      results.push({
        sourceId: source.id,
        driftDetected: false,
        skippedReason: "dismissed_upstream_ref_unchanged",
      });
      continue;
    }

    const alreadyExists = await hasExistingChangesetForRefPair(
      source.id,
      local.ref,
      upstream.ref,
      options
    );
    if (alreadyExists) {
      results.push({
        sourceId: source.id,
        driftDetected: false,
        skippedReason: "changeset_already_recorded",
      });
      continue;
    }

    const changesetId = formatChangesetId(source.id, detectedAt);
    const payload = await source.fetch(upstream.ref);
    const changeset = diffManifests(local, upstream, {
      sourceId: source.id,
      detectedAt: detectedAt.toISOString(),
      changesetId,
      registry: options.registry,
      upstreamPayload: payload.procedures,
    });

    if (!changeset) {
      results.push({ sourceId: source.id, driftDetected: false });
      continue;
    }

    for (const conflict of changeset.conflictsWithLocalEdits) {
      const entry = options.registry.get(conflict.procedureId);
      if (!entry) {
        continue;
      }
      const procedure = structuredClone(entry.procedure);
      procedure.frontmatter.conflicts.push(conflict.conflict);
      options.registry.update(conflict.procedureId, procedure);
    }

    await writeChangeset(changeset, options);
    results.push({ sourceId: source.id, driftDetected: true, changesetId });
  }

  return results;
}
