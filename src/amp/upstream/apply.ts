/**
 * Apply upstream changesets to the procedure registry (AMP §16.6).
 */

import type { PathContext } from "../config/paths.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import {
  parseCanonicalProcedure,
  ProcedureFrontmatterSchema,
  type CanonicalProcedure,
} from "../procedural/schema.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { propagateProcedures } from "../substrate/propagation/service.js";
import type { HarnessWriterRegistry } from "../substrate/propagation/types.js";
import type { RuntimeSemanticEntityRecord } from "../runtime-semantics/entity-record.js";
import {
  writeRuntimeSemanticEntity,
} from "../runtime-semantics/storage-writer.js";
import type { RuntimeSemanticEntityWriteResult } from "../runtime-semantics/storage-validation.js";
import {
  changesetHasRemainingApplyTargets,
  resolveApplyTargetNames,
} from "./apply-filters.js";
import { mapUpstreamAppliedToEntityRecord } from "./audit-mapper.js";
import { readChangeset, updateChangesetStatus } from "./changesets.js";
import type { ApplyResult, UpstreamSource } from "./types.js";

export type ApplyAuditWriter = (
  runtime: RuntimeStore,
  record: RuntimeSemanticEntityRecord
) => RuntimeSemanticEntityWriteResult;

export interface ApplyChangesetOptions extends PathContext {
  changesetId: string;
  registry: ProcedureRegistry;
  source: UpstreamSource;
  runtime?: RuntimeStore;
  writers?: HarnessWriterRegistry;
  only?: readonly string[];
  exclude?: readonly string[];
  confirmBreaking?: boolean;
  acceptUpstream?: readonly string[];
  projectRef?: string;
  syncedAt?: string;
  writeAudit?: ApplyAuditWriter;
}

function bumpPatchVersion(version: string): string {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    parts[2] += 1;
    return parts.join(".");
  }
  return `${version}.1`;
}

function withUpstreamProvenance(
  procedure: CanonicalProcedure,
  sourceId: string,
  upstreamRef: string,
  syncedAt: string
): CanonicalProcedure {
  const provenance = procedure.frontmatter.provenance ?? {
    source: "import" as const,
    created_at: syncedAt,
  };

  return parseCanonicalProcedure({
    ...procedure,
    frontmatter: {
      ...procedure.frontmatter,
      provenance: {
        ...provenance,
        source: "import",
        updated_at: syncedAt,
        upstream: {
          source_id: sourceId,
          ref: upstreamRef,
          fetched_at: syncedAt,
          upstream_synced_at: syncedAt,
        },
      },
    },
  });
}

function detectRegistryConflicts(
  registry: ProcedureRegistry,
  procedure: CanonicalProcedure
): string | undefined {
  const name = procedure.frontmatter.name;
  for (const entry of registry.list()) {
    if (entry.procedure.frontmatter.name === name) {
      continue;
    }
    const overlaps = entry.procedure.frontmatter.triggers.filter((trigger) =>
      procedure.frontmatter.triggers.includes(trigger)
    );
    if (overlaps.length > 0) {
      return `Trigger overlap with ${entry.procedure.frontmatter.name}: ${overlaps.join(", ")}`;
    }
    if (entry.procedure.frontmatter.conflicts_with.includes(name)) {
      return `Declared conflict with ${entry.procedure.frontmatter.name}`;
    }
    if (procedure.frontmatter.conflicts_with.includes(entry.procedure.frontmatter.name)) {
      return `Declares conflict with ${entry.procedure.frontmatter.name}`;
    }
  }
  return undefined;
}

function snapshotRegistry(registry: ProcedureRegistry): Map<string, CanonicalProcedure> {
  const snapshot = new Map<string, CanonicalProcedure>();
  for (const entry of registry.list()) {
    snapshot.set(entry.procedure.frontmatter.name, structuredClone(entry.procedure));
  }
  return snapshot;
}

function restoreRegistrySnapshot(
  registry: ProcedureRegistry,
  snapshot: Map<string, CanonicalProcedure>
): void {
  for (const name of registry.list().map((entry) => entry.procedure.frontmatter.name)) {
    registry.remove(name);
  }
  for (const procedure of snapshot.values()) {
    registry.register(procedure);
  }
}

interface ValidatedApplyEntry {
  name: string;
  stamped: CanonicalProcedure;
}

export async function applyChangeset(options: ApplyChangesetOptions): Promise<ApplyResult> {
  const changeset = await readChangeset(options.changesetId, options);
  if (!changeset) {
    return {
      changesetId: options.changesetId,
      applied: [],
      skipped: [],
      ok: false,
      error: `Changeset not found: ${options.changesetId}`,
    };
  }

  if (changeset.status !== "pending" && changeset.status !== "partially-applied") {
    return {
      changesetId: options.changesetId,
      applied: [],
      skipped: [],
      ok: false,
      error: `Changeset ${options.changesetId} is ${changeset.status}, not pending.`,
    };
  }

  if (changeset.riskClass === "high" && !options.confirmBreaking) {
    return {
      changesetId: options.changesetId,
      applied: [],
      skipped: [],
      ok: false,
      error:
        "High-risk changeset requires --confirm-breaking. Review breaking changes before applying.",
    };
  }

  const acceptSet = new Set(options.acceptUpstream ?? []);
  for (const conflict of changeset.conflictsWithLocalEdits) {
    if (!acceptSet.has(conflict.procedureId)) {
      return {
        changesetId: options.changesetId,
        applied: [],
        skipped: [],
        ok: false,
        error: `Concurrent local edit on ${conflict.procedureId}; pass --accept-upstream ${conflict.procedureId} to overwrite.`,
      };
    }
  }

  const payload = await options.source.fetch(changeset.ref.upstream);
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const targetNames = resolveApplyTargetNames(changeset, options.only, options.exclude);

  const validatedEntries: ValidatedApplyEntry[] = [];
  const skipped: string[] = [];

  for (const name of targetNames) {
    const upstreamProcedure = payload.procedures[name];
    if (!upstreamProcedure) {
      skipped.push(name);
      continue;
    }

    ProcedureFrontmatterSchema.parse(upstreamProcedure.frontmatter);

    const conflictReason = detectRegistryConflicts(options.registry, upstreamProcedure);
    if (conflictReason) {
      skipped.push(name);
      continue;
    }

    validatedEntries.push({
      name,
      stamped: withUpstreamProvenance(
        {
          ...upstreamProcedure,
          frontmatter: {
            ...upstreamProcedure.frontmatter,
            version: options.registry.get(name)
              ? bumpPatchVersion(upstreamProcedure.frontmatter.version)
              : upstreamProcedure.frontmatter.version,
          },
        },
        changeset.sourceId,
        changeset.ref.upstream,
        syncedAt
      ),
    });
  }

  const snapshot = snapshotRegistry(options.registry);

  try {
    for (const entry of validatedEntries) {
      if (options.registry.get(entry.name)) {
        options.registry.update(entry.name, entry.stamped);
      } else {
        options.registry.register(entry.stamped);
      }
    }

    const applied = validatedEntries.map((entry) => entry.name);

    if (options.runtime) {
      const auditRecord = mapUpstreamAppliedToEntityRecord({
        recordId: `upstream-applied:${changeset.id}`,
        sourceId: changeset.sourceId,
        changesetId: changeset.id,
        applied,
        skipped,
        projectRef: options.projectRef,
        occurredAt: syncedAt,
        recordedAt: syncedAt,
      });
      const writeAudit = options.writeAudit ?? writeRuntimeSemanticEntity;
      const writeResult = writeAudit(options.runtime, auditRecord);
      if (!writeResult.ok) {
        throw new Error(writeResult.message);
      }
    }

    if (options.writers) {
      await propagateProcedures({
        registry: options.registry,
        writers: options.writers,
        syncedAt,
      });
    }

    const finalStatus = changesetHasRemainingApplyTargets(changeset, applied)
      ? "partially-applied"
      : "applied";
    await updateChangesetStatus(changeset.id, finalStatus, syncedAt, options);

    return { changesetId: changeset.id, applied, skipped, ok: true };
  } catch (error: unknown) {
    restoreRegistrySnapshot(options.registry, snapshot);
    const message = error instanceof Error ? error.message : String(error);
    return {
      changesetId: changeset.id,
      applied: [],
      skipped: targetNames,
      ok: false,
      error: message,
    };
  }
}
