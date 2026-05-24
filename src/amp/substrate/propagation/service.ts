/**
 * Procedure propagation service — compile registry artifacts to verified harness roots.
 *
 * Falsifiable claim: canonical procedures compile through existing adapters into
 * from-amp/ only, lastSyncedAt updates on success, and unsupported targets are reported.
 */

import { join } from "node:path";

import { ClaudeCodeAdapter } from "../../adapters/sas/claude-code/adapter.js";
import { CursorAdapter } from "../../adapters/sas/cursor/adapter.js";
import { HermesAdapter } from "../../adapters/sas/hermes/adapter.js";
import type { InjectionPath } from "../../procedural/schema.js";
import type { ProcedureRegistry } from "../../procedural/registry.js";
import {
  VERIFIED_HARNESS_TARGETS,
  type PropagateProceduresInput,
  type PropagationResult,
  type PropagationUnsupportedTarget,
  type PropagationWriteRecord,
  type VerifiedHarnessTarget,
} from "./types.js";

const VERIFIED_HARNESS_SET = new Set<string>(VERIFIED_HARNESS_TARGETS);

function defaultClaudeCodeBasePath(projectRoot: string): string {
  return join(projectRoot, ".claude", "skills");
}

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

interface HarnessWriters {
  cursor: CursorAdapter;
  "claude-code": ClaudeCodeAdapter;
  hermes: HermesAdapter;
}

function createHarnessWriters(roots: PropagateProceduresInput["roots"]): HarnessWriters {
  const claudeCodeBasePath = roots.claudeCodeBasePath ?? defaultClaudeCodeBasePath(roots.projectRoot);
  return {
    cursor: new CursorAdapter({ projectRoot: roots.projectRoot }),
    "claude-code": new ClaudeCodeAdapter({ basePath: claudeCodeBasePath }),
    hermes: new HermesAdapter({ projectRoot: roots.projectRoot }),
  };
}

async function writeToHarness(
  writers: HarnessWriters,
  harness: VerifiedHarnessTarget,
  procedure: import("../../procedural/schema.js").CanonicalProcedure
): Promise<string> {
  switch (harness) {
    case "cursor":
      return writers.cursor.writeCompiledRule(procedure);
    case "claude-code":
      return writers["claude-code"].writeCompiledProcedure(procedure);
    case "hermes":
      return writers.hermes.writeCompiledProcedure(procedure);
  }
}

/** Compile and write registry procedures to verified harness from-amp roots. */
export async function propagateProcedures(
  input: PropagateProceduresInput
): Promise<PropagationResult> {
  const targets = input.targets ?? VERIFIED_HARNESS_TARGETS;
  const syncedAt = input.syncedAt ?? new Date().toISOString();
  const writers = createHarnessWriters(input.roots);

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
    const canWriteFilesystem = supportsFilesystemPropagation(injectionPath);

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

      if (!canWriteFilesystem) {
        writes.push({
          procedureName,
          harness,
          status: "failed",
          message: `Cannot propagate with injection_path "${injectionPath}".`,
        });
        continue;
      }

      try {
        const outputPath = await writeToHarness(writers, harness, entry.procedure);
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
