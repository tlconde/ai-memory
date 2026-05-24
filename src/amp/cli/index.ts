/**
 * AMP CLI command group shell for ai-memory.
 *
 * Falsifiable claim: registerAmpCommands adds an `amp` top-level group without
 * altering existing ai-memory commands.
 */

import type { Command } from "commander";

import { formatAmpInitMessages, runAmpInit } from "./init.js";

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
    .command("status")
    .description("Show AMP CLI shell status (subcommands land in later v1 tasks)")
    .action(() => {
      process.stdout.write(`AMP CLI shell v${AMP_CLI_SHELL_VERSION}\n`);
      process.stdout.write(
        "Planned: doctor, capture, consolidate, retrieve, propagate (not wired in this task).\n"
      );
    });

  return amp;
}
