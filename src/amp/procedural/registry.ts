/**
 * In-memory canonical procedure registry.
 *
 * Falsifiable claim: procedures round-trip through CRUD with version metadata,
 * conflict records, and per-harness last-synced timestamps preserved.
 */

import type { CanonicalProcedure, ProcedureConflict } from "./schema.js";
import { parseCanonicalProcedure } from "./schema.js";

export class ProcedureRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcedureRegistryError";
  }
}

export interface ProcedureRegistryEntry {
  procedure: CanonicalProcedure;
  /** Denormalized from frontmatter.version for quick access. */
  version: string;
  /** Declared name conflicts from frontmatter.conflicts_with. */
  conflictsWith: string[];
  /** Detected conflict metadata from frontmatter.conflicts. */
  conflicts: ProcedureConflict[];
  /** ISO-8601 timestamps of last successful sync per harness target. */
  lastSyncedAt: Record<string, string>;
}

function entryFromProcedure(
  procedure: CanonicalProcedure,
  lastSyncedAt: Record<string, string> = {}
): ProcedureRegistryEntry {
  return {
    procedure,
    version: procedure.frontmatter.version,
    conflictsWith: [...procedure.frontmatter.conflicts_with],
    conflicts: procedure.frontmatter.conflicts.map((conflict) => ({ ...conflict })),
    lastSyncedAt: { ...lastSyncedAt },
  };
}

export class ProcedureRegistry {
  private readonly entries = new Map<string, ProcedureRegistryEntry>();

  register(procedure: CanonicalProcedure): ProcedureRegistryEntry {
    const validated = parseCanonicalProcedure(procedure);
    const name = validated.frontmatter.name;
    if (this.entries.has(name)) {
      throw new ProcedureRegistryError(`Procedure already registered: ${name}`);
    }
    const entry = entryFromProcedure(validated);
    this.entries.set(name, entry);
    return structuredClone(entry);
  }

  get(name: string): ProcedureRegistryEntry | undefined {
    const entry = this.entries.get(name);
    return entry ? structuredClone(entry) : undefined;
  }

  list(): ProcedureRegistryEntry[] {
    return [...this.entries.values()].map((entry) => structuredClone(entry));
  }

  update(name: string, procedure: CanonicalProcedure): ProcedureRegistryEntry {
    const existing = this.entries.get(name);
    if (!existing) {
      throw new ProcedureRegistryError(`Procedure not found: ${name}`);
    }
    const validated = parseCanonicalProcedure(procedure);
    if (validated.frontmatter.name !== name) {
      throw new ProcedureRegistryError(
        `Procedure name mismatch: expected ${name}, got ${validated.frontmatter.name}`
      );
    }
    const entry = entryFromProcedure(validated, existing.lastSyncedAt);
    this.entries.set(name, entry);
    return structuredClone(entry);
  }

  remove(name: string): boolean {
    return this.entries.delete(name);
  }

  setLastSyncedAt(name: string, harness: string, isoTimestamp: string): void {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new ProcedureRegistryError(`Procedure not found: ${name}`);
    }
    entry.lastSyncedAt[harness] = isoTimestamp;
  }
}
