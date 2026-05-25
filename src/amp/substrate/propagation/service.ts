/**
 * Procedure propagation service — compile registry artifacts to verified harness roots.
 *
 * Falsifiable claim: canonical procedures propagate through injected harness
 * writers only, lastSyncedAt updates on success, and unsupported targets are reported.
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import type { InjectionPath } from "../../procedural/schema.js";
import type { ProcedureRegistry } from "../../procedural/registry.js";
import {
  VERIFIED_HARNESS_TARGETS,
  type HarnessWriterRegistry,
  type PropagateProceduresInput,
  type PropagationResult,
  type PropagationUnsupportedTarget,
  type PropagationWriteRecord,
  type VerifiedHarnessTarget,
} from "./types.js";

const VERIFIED_HARNESS_SET = new Set<string>(VERIFIED_HARNESS_TARGETS);

function supportsFilesystemPropagation(injectionPath: InjectionPath): boolean {
  return injectionPath === "filesystem-native" || injectionPath === "either";
}

function collectUnsupportedDeclaredTargets(
  procedureName: string,
  supportedHarnesses: readonly string[],
  injectionPath: InjectionPath
): PropagationUnsupportedTarget[] {
  const conflicts: PropagationUnsupportedTarget[] = [];

  if (!supportsFilesystemPropagation(injectionPath)) {
    for (const harness of supportedHarnesses) {
      if (VERIFIED_HARNESS_SET.has(harness)) {
        conflicts.push({
          procedureName,
          harness,
          reason: `Procedure declares injection_path "${injectionPath}"; filesystem propagation requires filesystem-native or either.`,
        });
      }
    }
    return conflicts;
  }

  for (const harness of supportedHarnesses) {
    if (!VERIFIED_HARNESS_SET.has(harness)) {
      conflicts.push({
        procedureName,
        harness,
        reason: `Harness "${harness}" is not a verified v1 propagation target.`,
      });
    }
  }

  return conflicts;
}

/** Compile and write registry procedures to verified harness from-amp roots. */
export async function propagateProcedures(
  input: PropagateProceduresInput
): Promise<PropagationResult> {
  const targets = input.targets ?? VERIFIED_HARNESS_TARGETS;
  const syncedAt = input.syncedAt ?? new Date().toISOString();

  const writes: PropagationWriteRecord[] = [];
  const unsupportedTargets: PropagationUnsupportedTarget[] = [];

  for (const entry of input.registry.list()) {
    const procedureName = entry.procedure.frontmatter.name;
    const supportedHarnesses = entry.procedure.frontmatter.harness_compatibility.supported_harnesses;
    const injectionPath = entry.procedure.frontmatter.harness_compatibility.injection_path;

    unsupportedTargets.push(
      ...collectUnsupportedDeclaredTargets(procedureName, supportedHarnesses, injectionPath)
    );

    const supportedSet = new Set(supportedHarnesses);
    if (!supportsFilesystemPropagation(injectionPath)) {
      continue;
    }

    for (const harness of targets) {
      if (!supportedSet.has(harness)) {
        writes.push({
          procedureName,
          harness,
          status: "skipped",
          message: "Procedure does not declare this harness in supported_harnesses.",
        });
        continue;
      }

      const writer = input.writers[harness];
      if (!writer) {
        writes.push({
          procedureName,
          harness,
          status: "failed",
          message: `No writer configured for harness "${harness}".`,
        });
        continue;
      }

      try {
        const outputPath = await writer.writeProcedure(entry.procedure);
        input.registry.setLastSyncedAt(procedureName, harness, syncedAt);
        writes.push({
          procedureName,
          harness,
          status: "written",
          outputPath,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        writes.push({
          procedureName,
          harness,
          status: "failed",
          message,
        });
      }
    }
  }

  return { writes, unsupportedTargets };
}

export type { ProcedureRegistry };
