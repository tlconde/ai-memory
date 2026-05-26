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
  formatAmpAgentSetupReport,
  isAmpAgentSetupTarget,
  runAmpAgentSetup,
} from "./agent-setup.js";
import {
  formatAmpProjectionRenderReport,
  runAmpProjectionRender,
} from "./projection.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "./retrieve.js";
import {
  formatAmpRuntimeCorrectJson,
  formatAmpRuntimeCorrectReport,
  formatAmpRuntimeInspectJson,
  formatAmpRuntimeInspectReport,
  formatAmpRuntimeStatusReport,
  runAmpRuntimeCorrect,
  runAmpRuntimeInspect,
  runAmpRuntimeStatus,
} from "./runtime.js";
import { confirmLiveGbrainWriteFromCliOptions } from "./live-gbrain-safety.js";

export const AMP_CLI_SHELL_VERSION = "1.0.0";

export type RegisterAmpCommandsOptions = {
  /** When true, register AMP commands on `program` instead of under an `amp` subgroup. */
  atRoot?: boolean;
};

/** Register AMP commands on the root ai-memory program or directly at root for the `amp` binary. */
export function registerAmpCommands(
  program: Command,
  options: RegisterAmpCommandsOptions = {}
): Command {
  const amp = options.atRoot
    ? program
    : program.command("amp").description(
        "Agent Memory Protocol (AMP) substrate — init, doctor, capture, consolidate, retrieve, propagate, projection, runtime, agent setup"
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
    .description("Plan or apply projection artifacts on disk")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--source <kind>", "Projection source: placeholder (default), local, or gbrain")
    .option("--dry-run", "Plan writes without touching disk")
    .option("--apply", "Apply writes (requires --source local or gbrain)")
    .action(
      async (opts: {
        projectRoot?: string;
        source?: string;
        dryRun?: boolean;
        apply?: boolean;
      }) => {
        const source =
          opts.source === "local" ||
          opts.source === "placeholder" ||
          opts.source === "gbrain"
            ? opts.source
            : undefined;
        if (opts.source && !source) {
          process.stderr.write(
            `Invalid projection source "${opts.source}" — expected placeholder, local, or gbrain.\n`
          );
          process.exitCode = 1;
          return;
        }

        const result = await runAmpProjectionRender({
          projectRoot: opts.projectRoot,
          source,
          dryRun: opts.dryRun ?? false,
          apply: opts.apply ?? false,
        });
        for (const line of formatAmpProjectionRenderReport(result)) {
          process.stdout.write(`${line}\n`);
        }
        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );

  const agent = amp.command("agent").description("Local agent-access setup for materialized projections");

  agent
    .command("setup")
    .description("Plan or apply Claude Code / Cursor projection wiring")
    .requiredOption("--target <kind>", "Setup target: claude-code, cursor, or codex")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--dry-run", "Plan setup without touching disk (default when --apply omitted)")
    .option("--apply", "Apply setup writes")
    .action(
      async (opts: {
        target: string;
        projectRoot?: string;
        dryRun?: boolean;
        apply?: boolean;
      }) => {
        if (!isAmpAgentSetupTarget(opts.target)) {
          process.stderr.write(
            `Invalid agent setup target "${opts.target}" — expected claude-code, cursor, or codex.\n`
          );
          process.exitCode = 1;
          return;
        }

        const result = await runAmpAgentSetup({
          projectRoot: opts.projectRoot,
          target: opts.target,
          apply: opts.apply ?? false,
        });
        for (const line of formatAmpAgentSetupReport(result)) {
          process.stdout.write(`${line}\n`);
        }
        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );

  const runtime = amp
    .command("runtime")
    .description("Runtime semantics inspection and correction (local-only stubs)");

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
    .description("Inspect runtime semantic state (read-only stub until storage is wired)")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--entity <kind>", "Runtime entity kind slug (e.g. episodic-frame)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action((opts: { projectRoot?: string; entity?: string; json?: boolean }) => {
      const result = runAmpRuntimeInspect({
        projectRoot: opts.projectRoot,
        entity: opts.entity,
      });
      if (opts.json) {
        process.stdout.write(`${formatAmpRuntimeInspectJson(result)}\n`);
      } else {
        for (const line of formatAmpRuntimeInspectReport(result)) {
          process.stdout.write(`${line}\n`);
        }
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  runtime
    .command("correct")
    .description("Explicit runtime correction/reclassify stub (not wired yet)")
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
        if (opts.json) {
          process.stdout.write(`${formatAmpRuntimeCorrectJson(result)}\n`);
        } else {
          for (const line of formatAmpRuntimeCorrectReport(result)) {
            process.stdout.write(`${line}\n`);
          }
        }
        process.exitCode = 1;
      }
    );

  amp
    .command("status")
    .description("Show AMP CLI shell status")
    .action(() => {
      process.stdout.write(`AMP CLI shell v${AMP_CLI_SHELL_VERSION}\n`);
      process.stdout.write(
        "Wired: init, doctor, gbrain-preflight, capture, consolidate, retrieve, propagate, projection render (placeholder dry-run; local source with --source local when AMP_KNOWLEDGE_BACKEND=in-memory; gbrain read-only source with --source gbrain), runtime status/inspect/correct (schema stubs; storage not wired), agent setup (claude-code, cursor, and codex dry-run/apply).\n"
      );
    });

  return amp;
}
