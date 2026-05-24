/**
 * AMP CLI command group shell for ai-memory.
 *
 * Falsifiable claim: registerAmpCommands adds an `amp` top-level group without
 * altering existing ai-memory commands.
 */

import type { Command } from "commander";

export const AMP_CLI_SHELL_VERSION = "1.0.0";

/** Register the AMP command group on the root ai-memory program. */
export function registerAmpCommands(program: Command): Command {
  const amp = program
    .command("amp")
    .description(
      "Agent Memory Protocol (AMP) substrate — init, doctor, capture, consolidate, retrieve, propagate"
    );

  amp
    .command("status")
    .description("Show AMP CLI shell status (subcommands land in later v1 tasks)")
    .action(() => {
      process.stdout.write(`AMP CLI shell v${AMP_CLI_SHELL_VERSION}\n`);
      process.stdout.write(
        "Planned: init, doctor, capture, consolidate, retrieve, propagate (not wired in this task).\n"
      );
    });

  return amp;
}
