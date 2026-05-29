/**
 * Diff local and upstream manifests into an UpstreamChangeset (AMP §16.4).
 */

import type { CanonicalProcedure } from "../procedural/schema.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import type {
  BreakingChange,
  ConflictRef,
  UpstreamChangeset,
  UpstreamManifest,
  UpstreamRiskClass,
} from "./types.js";

export interface DiffManifestsOptions {
  sourceId: string;
  detectedAt: string;
  changesetId: string;
  registry: ProcedureRegistry;
  upstreamPayload?: Record<string, CanonicalProcedure>;
}

function classifyProcedureUpdateRisk(
  local: CanonicalProcedure | undefined,
  upstream: CanonicalProcedure
): UpstreamRiskClass {
  if (!local) {
    return "low";
  }

  const localFm = local.frontmatter;
  const upstreamFm = upstream.frontmatter;

  const localHarness = new Set(localFm.harness_compatibility.supported_harnesses);
  const upstreamHarness = new Set(upstreamFm.harness_compatibility.supported_harnesses);
  for (const harness of localHarness) {
    if (!upstreamHarness.has(harness)) {
      return "high";
    }
  }

  if (localFm.mutating === false && upstreamFm.mutating === true) {
    return "medium";
  }
  if (localFm.writes_pages === false && upstreamFm.writes_pages === true) {
    return "medium";
  }

  const localTools = [...localFm.tools].sort().join(",");
  const upstreamTools = [...upstreamFm.tools].sort().join(",");
  if (localTools !== upstreamTools) {
    return "medium";
  }

  return "low";
}

function summarizeDiff(local: CanonicalProcedure | undefined, upstream: CanonicalProcedure): string {
  if (!local) {
    return "New procedure from upstream.";
  }

  const parts: string[] = [];
  if (local.body !== upstream.body) {
    parts.push("body prose changed");
  }
  const localTriggers = local.frontmatter.triggers.join(", ");
  const upstreamTriggers = upstream.frontmatter.triggers.join(", ");
  if (localTriggers !== upstreamTriggers) {
    parts.push("Triggers section changed");
  }
  if (parts.length === 0) {
    return "Metadata or version changed.";
  }
  return parts.join("; ");
}

function buildUnifiedDiff(local: CanonicalProcedure | undefined, upstream: CanonicalProcedure): string {
  const localLabel = local ? `local@${local.frontmatter.version}` : "local/(missing)";
  const upstreamLabel = `upstream@${upstream.frontmatter.version}`;
  return [`--- ${localLabel}`, `+++ ${upstreamLabel}`, "@@ procedure body @@", upstream.body].join(
    "\n"
  );
}

function aggregateRiskClass(
  perItem: UpstreamRiskClass[],
  breakingChanges: BreakingChange[],
  hasRemoved: boolean
): UpstreamRiskClass {
  if (breakingChanges.some((change) => change.riskClass === "high") || hasRemoved) {
    return "high";
  }
  if (perItem.includes("high")) {
    return "high";
  }
  if (perItem.includes("medium")) {
    return "medium";
  }
  return "low";
}

function detectLocalEditConflicts(
  registry: ProcedureRegistry,
  upstream: UpstreamManifest,
  updatedIds: readonly string[]
): ConflictRef[] {
  const conflicts: ConflictRef[] = [];
  const upstreamById = new Map(upstream.procedures.map((entry) => [entry.id, entry]));

  for (const procedureId of updatedIds) {
    const entry = registry.get(procedureId);
    const upstreamEntry = upstreamById.get(procedureId);
    if (!entry || !upstreamEntry) {
      continue;
    }

    const provenance = entry.procedure.frontmatter.provenance;
    const upstreamSyncedAt = provenance?.upstream?.upstream_synced_at;
    const localUpdatedAt = provenance?.updated_at ?? provenance?.created_at;
    if (!upstreamSyncedAt || !localUpdatedAt) {
      continue;
    }

    if (localUpdatedAt > upstreamSyncedAt && upstreamEntry.updated_at > upstreamSyncedAt) {
      conflicts.push({
        procedureId,
        conflict: {
          with: procedureId,
          reason: "concurrent_edit",
          detected_at: new Date().toISOString(),
        },
        localUpdatedAt,
        upstreamUpdatedAt: upstreamEntry.updated_at,
      });
    }
  }

  return conflicts;
}

/** Compare local and upstream manifests and produce an UpstreamChangeset. */
export function diffManifests(
  local: UpstreamManifest,
  upstream: UpstreamManifest,
  options: DiffManifestsOptions
): UpstreamChangeset | undefined {
  const localById = new Map(local.procedures.map((entry) => [entry.id, entry]));
  const upstreamById = new Map(upstream.procedures.map((entry) => [entry.id, entry]));

  const added = upstream.procedures
    .filter((entry) => !localById.has(entry.id))
    .map((entry) => ({ id: entry.id, version: entry.version }));

  const removed = local.procedures
    .filter((entry) => !upstreamById.has(entry.id))
    .map((entry) => ({ id: entry.id, version: entry.version }));

  const updated = [];
  const perItemRisk: UpstreamRiskClass[] = [];

  for (const upstreamEntry of upstream.procedures) {
    const localEntry = localById.get(upstreamEntry.id);
    if (!localEntry || localEntry.checksum === upstreamEntry.checksum) {
      continue;
    }

    const localProcedure = options.registry.get(upstreamEntry.id)?.procedure;
    const upstreamProcedure = options.upstreamPayload?.[upstreamEntry.id];
    const riskClass = upstreamProcedure
      ? classifyProcedureUpdateRisk(localProcedure, upstreamProcedure)
      : "medium";

    perItemRisk.push(riskClass);
    updated.push({
      id: upstreamEntry.id,
      localVersion: localEntry.version,
      upstreamVersion: upstreamEntry.version,
      diffSummary: upstreamProcedure
        ? summarizeDiff(localProcedure, upstreamProcedure)
        : "Checksum drift detected.",
      diffUnified: upstreamProcedure
        ? buildUnifiedDiff(localProcedure, upstreamProcedure)
        : "",
      riskClass,
    });
  }

  const breakingChanges: BreakingChange[] = (upstream.schemaChanges ?? [])
    .filter((change) => change.breaking)
    .map((change) => ({
      id: change.id,
      description: change.description,
      riskClass: "high" as const,
    }));

  if (removed.length > 0) {
    breakingChanges.push({
      id: "removed-procedures",
      description: `${removed.length} procedure(s) removed upstream.`,
      riskClass: "high",
    });
  }

  const conflictsWithLocalEdits = detectLocalEditConflicts(
    options.registry,
    upstream,
    updated.map((entry) => entry.id)
  );

  if (
    added.length === 0 &&
    updated.length === 0 &&
    removed.length === 0 &&
    breakingChanges.length === 0
  ) {
    return undefined;
  }

  const riskClass = aggregateRiskClass(perItemRisk, breakingChanges, removed.length > 0);

  return {
    id: options.changesetId,
    sourceId: options.sourceId,
    detectedAt: options.detectedAt,
    ref: { local: local.ref, upstream: upstream.ref },
    added,
    updated,
    removed,
    breakingChanges,
    conflictsWithLocalEdits,
    riskClass,
  };
}
