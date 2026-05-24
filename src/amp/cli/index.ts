/**
 * AMP CLI command group shell for ai-memory.
 *
 * Falsifiable claim: registerAmpCommands adds an `amp` top-level group without
 * altering existing ai-memory commands.
 */

import type { Command } from "commander";

import { formatAmpDoctorReport, runAmpDoctor } from "./doctor.js";
import { formatAmpInitMessages, runAmpInit } from "./init.js";
import { formatAmpPropagateReport, runAmpPropagate } from "./propagate.js";

export const AMP_CLI_SHELL_VERSION = "1.0.0";

/** Register the AMP command group on the root ai-memory program. */
export function registerAmpCommands(program: Command): Command {
  const amp = program
    .command("amp")
    .description(
      "Agent Memory Protocol (AMP) substrate — init, doctor, capture, consolidate, retrieve, propagate"
    );

  amp
    .command("init")
    .description("Create project-local AMP config and runtime directories")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--force", "Overwrite existing .amp/config.yaml")
    .action(async (opts: { projectRoot?: string; force?: boolean }) => {
      const result = await runAmpInit({
        projectRoot: opts.projectRoot,
        force: opts.force ?? false,
      });
      for (const line of formatAmpInitMessages(result)) {
        process.stdout.write(`${line}\n`);
      }
    });

  amp
    .command("doctor")
    .description("Inspect config, runtime, SSA/SAS specs, paths, and capability gaps")
    .option("--project-root <path>", "Project root (default: current directory)")
    .action(async (opts: { projectRoot?: string }) => {
      const result = runAmpDoctor({ projectRoot: opts.projectRoot });
      for (const line of formatAmpDoctorReport(result)) {
        process.stdout.write(`${line}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  amp
    .command("propagate")
    .description("Compile registry procedures to verified harness from-amp roots")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option(
      "--targets <harnesses>",
      "Comma-separated verified harness targets (cursor, claude-code, hermes)"
    )
    .action(async (opts: { projectRoot?: string; targets?: string }) => {
      const result = await runAmpPropagate({
        projectRoot: opts.projectRoot,
        targets: opts.targets,
      });
      for (const line of formatAmpPropagateReport(result)) {
        process.stdout.write(`${line}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  amp
    .command("status")
    .description("Show AMP CLI shell status")
    .action(() => {
      process.stdout.write(`AMP CLI shell v${AMP_CLI_SHELL_VERSION}\n`);
      process.stdout.write("Wired: init, doctor, propagate.\n");
      process.stdout.write(
        "Planned: capture, consolidate, retrieve (not wired yet).\n"
      );
    });

  return amp;
}
