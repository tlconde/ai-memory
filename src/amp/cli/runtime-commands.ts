/**
 * AMP runtime CLI command registration.
 *
 * Falsifiable claim: runtime status/inspect/correct/seed/graduation plan commands
 * register through one helper without duplicating Commander wiring in index.ts.
 */

import type { Command } from "commander";

import {
  formatAmpRuntimeCorrectJson,
  formatAmpRuntimeCorrectReport,
  formatAmpRuntimeStatusReport,
  runAmpRuntimeCorrect,
  runAmpRuntimeStatus,
  writeAmpRuntimeCliResult,
} from "./runtime.js";
import {
  formatAmpRuntimeGraduationApplyJson,
  formatAmpRuntimeGraduationApplyReport,
  runAmpRuntimeGraduationApply,
} from "./runtime-graduation-apply.js";
import {
  formatAmpRuntimeGraduationPlanJson,
  formatAmpRuntimeGraduationPlanReport,
  runAmpRuntimeGraduationPlan,
} from "./runtime-graduation-plan.js";
import {
  formatAmpRuntimeInspectJson,
  formatAmpRuntimeInspectReport,
  runAmpRuntimeInspect,
} from "./runtime-inspect.js";
import {
  formatAmpRuntimeSeedJson,
  formatAmpRuntimeSeedReport,
  runAmpRuntimeSeed,
} from "./runtime-seed.js";

/** Register `amp runtime` subcommands on the AMP command group. */
export function registerAmpRuntimeCommands(amp: Command): Command {
  const runtime = amp
    .command("runtime")
    .description(
      "Runtime semantics inspection, seeding, and correction (inspect/seed/correct on local typed storage); graduation review via graduation plan/apply"
    );

  runtime
    .command("status")
    .description("Report runtime semantics feature status and supported entity schemas")
    .action(() => {
      const result = runAmpRuntimeStatus();
      for (const line of formatAmpRuntimeStatusReport(result)) {
        process.stdout.write(`${line}\n`);
      }
    });

  runtime
    .command("inspect")
    .description(
      "Experimental operator command — inspect persisted typed runtime semantic entities (read-only)"
    )
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--entity <kind>", "Runtime entity kind slug (e.g. episodic-frame)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action((opts: { projectRoot?: string; entity?: string; json?: boolean }) => {
      const result = runAmpRuntimeInspect({
        projectRoot: opts.projectRoot,
        entity: opts.entity,
      });
      writeAmpRuntimeCliResult({
        result,
        json: opts.json,
        formatJson: formatAmpRuntimeInspectJson,
        formatReport: formatAmpRuntimeInspectReport,
      });
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  runtime
    .command("correct")
    .description("Capture an explicit operator correction into typed runtime semantic storage")
    .requiredOption("--id <id>", "Runtime entity id to correct")
    .requiredOption("--note <text>", "Operator note describing the correction intent")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action(
      (opts: {
        id: string;
        note: string;
        projectRoot?: string;
        json?: boolean;
      }) => {
        const result = runAmpRuntimeCorrect({
          projectRoot: opts.projectRoot,
          id: opts.id,
          note: opts.note,
        });
        writeAmpRuntimeCliResult({
          result,
          json: opts.json,
          formatJson: formatAmpRuntimeCorrectJson,
          formatReport: formatAmpRuntimeCorrectReport,
        });
        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );

  runtime
    .command("seed")
    .description(
      "Experimental operator command — seed typed runtime semantic entities from JSON (testing/local only)"
    )
    .requiredOption("--file <path>", "JSON file with one entity record or an array of records")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action(async (opts: { file: string; projectRoot?: string; json?: boolean }) => {
      const result = await runAmpRuntimeSeed({
        projectRoot: opts.projectRoot,
        file: opts.file,
      });
      writeAmpRuntimeCliResult({
        result,
        json: opts.json,
        formatJson: formatAmpRuntimeSeedJson,
        formatReport: formatAmpRuntimeSeedReport,
      });
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  const graduation = runtime
    .command("graduation")
    .description("Graduation planning and explicit apply for typed runtime semantic entities");

  graduation
    .command("plan")
    .description(
      "Experimental operator command — review graduation decisions for persisted typed runtime entities (read-only)"
    )
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--entity <kind>", "Runtime entity kind slug (e.g. episodic-frame)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action((opts: { projectRoot?: string; entity?: string; json?: boolean }) => {
      const result = runAmpRuntimeGraduationPlan({
        projectRoot: opts.projectRoot,
        entity: opts.entity,
      });
      writeAmpRuntimeCliResult({
        result,
        json: opts.json,
        formatJson: formatAmpRuntimeGraduationPlanJson,
        formatReport: formatAmpRuntimeGraduationPlanReport,
      });
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  graduation
    .command("apply")
    .description(
      "Experimental operator command — apply one graduate runtime-preference-candidate to local durable knowledge"
    )
    .requiredOption("--id <id>", "Runtime entity id to apply")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action((opts: { id: string; projectRoot?: string; json?: boolean }) => {
      const result = runAmpRuntimeGraduationApply({
        projectRoot: opts.projectRoot,
        id: opts.id,
      });
      writeAmpRuntimeCliResult({
        result,
        json: opts.json,
        formatJson: formatAmpRuntimeGraduationApplyJson,
        formatReport: formatAmpRuntimeGraduationApplyReport,
      });
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  return runtime;
}
