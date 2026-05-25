/**
 * AMP CLI command group shell for ai-memory.
 *
 * Falsifiable claim: registerAmpCommands adds an `amp` top-level group without
 * altering existing ai-memory commands.
 */

import type { Command } from "commander";

import { formatAmpCaptureMessages, runAmpCapture } from "./capture.js";
import { formatAmpConsolidateMessages, runAmpConsolidate } from "./consolidate.js";
import { formatAmpDoctorReport, runAmpDoctor } from "./doctor.js";
import {
  formatAmpGbrainPreflightReport,
  runAmpGbrainPreflight,
} from "./gbrain-preflight.js";
import { formatAmpInitMessages, runAmpInit } from "./init.js";
import { formatAmpPropagateReport, runAmpPropagate } from "./propagate.js";
import {
  formatAmpProjectionRenderReport,
  runAmpProjectionRender,
} from "./projection.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "./retrieve.js";
import { confirmLiveGbrainWriteFromCliOptions } from "./live-gbrain-safety.js";

export const AMP_CLI_SHELL_VERSION = "1.0.0";

/** Register the AMP command group on the root ai-memory program. */
export function registerAmpCommands(program: Command): Command {
  const amp = program
    .command("amp")
    .description(
      "Agent Memory Protocol (AMP) substrate — init, doctor, capture, consolidate, retrieve, propagate, projection"
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
    .command("gbrain-preflight")
    .description("Read-only checks before live gbrain operator testing")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option(
      "--knowledge <backend>",
      "Knowledge backend to evaluate: gbrain, fake-gbrain, or in-memory"
    )
    .action((opts: { projectRoot?: string; knowledge?: string }) => {
      const result = runAmpGbrainPreflight({
        projectRoot: opts.projectRoot,
        knowledge: opts.knowledge,
      });
      for (const line of formatAmpGbrainPreflightReport(result)) {
        process.stdout.write(`${line}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  amp
    .command("capture")
    .description("Capture a preference signal into the runtime queue")
    .requiredOption("--content <text>", "Preference content to capture")
    .option("--scope <scope>", "Scope: project, user, or universal", "project")
    .option("--project-ref <ref>", "Project ref (required for project scope; defaults from config)")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--surface <surface>", "Capture surface label", "cursor")
    .action(
      (opts: {
        content: string;
        scope?: string;
        projectRef?: string;
        projectRoot?: string;
        surface?: string;
      }) => {
        const result = runAmpCapture({
          content: opts.content,
          scope: opts.scope as "project" | "user" | "universal" | undefined,
          projectRef: opts.projectRef,
          projectRoot: opts.projectRoot,
          surface: opts.surface,
        });
        for (const line of formatAmpCaptureMessages(result)) {
          process.stdout.write(`${line}\n`);
        }
      }
    );

  amp
    .command("consolidate")
    .description("Consolidate runtime queue into knowledge storage")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option(
      "--knowledge <backend>",
      "Knowledge backend: gbrain (live), fake-gbrain (test-only), or in-memory (default: gbrain)"
    )
    .option(
      "--confirm-live-gbrain-write",
      "Required for live gbrain writes when --knowledge gbrain (or set AMP_CONFIRM_LIVE_GBRAIN_WRITE=1)"
    )
    .option(
      "--live-gbrain",
      "Deprecated alias for --confirm-live-gbrain-write"
    )
    .action(async (opts: {
      projectRoot?: string;
      knowledge?: string;
      liveGbrain?: boolean;
      confirmLiveGbrainWrite?: boolean;
    }) => {
      const result = await runAmpConsolidate({
        projectRoot: opts.projectRoot,
        knowledge: opts.knowledge,
        confirmLiveGbrainWrite: confirmLiveGbrainWriteFromCliOptions({
          confirmLiveGbrainWrite: opts.confirmLiveGbrainWrite,
          deprecatedLiveGbrainAlias: opts.liveGbrain,
        }),
      });
      for (const line of formatAmpConsolidateMessages(result)) {
        process.stdout.write(`${line}\n`);
      }
    });

  amp
    .command("retrieve")
    .description("Retrieve consolidated preferences from knowledge storage")
    .option("--scope <scope>", "Scope: project, user, or universal", "project")
    .option("--project-ref <ref>", "Project ref filter (defaults from config for project scope)")
    .option("--query <text>", "Optional content filter")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option(
      "--knowledge <backend>",
      "Knowledge backend: gbrain (live), fake-gbrain (test-only), or in-memory (default: gbrain)"
    )
    .action(
      async (opts: {
        scope?: string;
        projectRef?: string;
        query?: string;
        projectRoot?: string;
        knowledge?: string;
      }) => {
        const result = await runAmpRetrieve({
          scope: opts.scope as "project" | "user" | "universal" | undefined,
          projectRef: opts.projectRef,
          query: opts.query,
          projectRoot: opts.projectRoot,
          knowledge: opts.knowledge,
        });
        for (const line of formatAmpRetrieveMessages(result)) {
          process.stdout.write(`${line}\n`);
        }
      }
    );

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

  const projection = amp
    .command("projection")
    .description("Filesystem projection artifact planning and materialization");

  projection
    .command("render")
    .description("Render projection artifacts (placeholder fixtures until AMP-PROJ-13)")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--dry-run", "Plan writes without touching disk")
    .action(async (opts: { projectRoot?: string; dryRun?: boolean }) => {
      const result = await runAmpProjectionRender({
        projectRoot: opts.projectRoot,
        dryRun: opts.dryRun ?? false,
      });
      for (const line of formatAmpProjectionRenderReport(result)) {
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
      process.stdout.write(
        "Wired: init, doctor, gbrain-preflight, capture, consolidate, retrieve, propagate, projection render --dry-run.\n"
      );
    });

  return amp;
}
