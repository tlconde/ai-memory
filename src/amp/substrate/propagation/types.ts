/**
 * Propagation service types for verified harness targets.
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import type { ProcedureRegistry } from "../../procedural/registry.js";

/** Harness IDs with verified filesystem adapters in v1. */
export const VERIFIED_HARNESS_TARGETS = ["cursor", "claude-code", "hermes"] as const;

export type VerifiedHarnessTarget = (typeof VERIFIED_HARNESS_TARGETS)[number];

export interface PropagationHarnessRoots {
  projectRoot: string;
  /** Claude Code skills root; defaults to `<projectRoot>/.claude/skills`. */
  claudeCodeBasePath?: string;
}

export interface PropagateProceduresInput {
  registry: ProcedureRegistry;
  writers: HarnessWriterRegistry;
  /** Limit propagation to these verified targets. Defaults to all verified targets. */
  targets?: readonly VerifiedHarnessTarget[];
  /** ISO-8601 timestamp recorded in the registry after successful writes. */
  syncedAt?: string;
}

export interface HarnessWriter {
  writeProcedure(procedure: CanonicalProcedure): Promise<string>;
}

export type HarnessWriterRegistry = Partial<Record<VerifiedHarnessTarget, HarnessWriter>>;

export type PropagationWriteStatus = "written" | "skipped" | "failed";

export interface PropagationWriteRecord {
  procedureName: string;
  harness: VerifiedHarnessTarget;
  status: PropagationWriteStatus;
  outputPath?: string;
  message?: string;
}

export interface PropagationUnsupportedTarget {
  procedureName: string;
  harness: string;
  reason: string;
}

export interface PropagationResult {
  writes: PropagationWriteRecord[];
  unsupportedTargets: PropagationUnsupportedTarget[];
}
