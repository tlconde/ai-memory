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
  formatAmpKnowledgeListJson,
  formatAmpKnowledgeListReport,
  runAmpKnowledgeList,
} from "./knowledge-list.js";
import {
  formatAmpKnowledgeStatusJson,
  formatAmpKnowledgeStatusReport,
  runAmpKnowledgeStatus,
} from "./knowledge-status.js";
import {
  formatAmpProjectionRenderReport,
  runAmpProjectionRender,
} from "./projection.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "./retrieve.js";
import { registerAmpRuntimeCommands } from "./runtime-commands.js";
import { writeAmpRuntimeCliResult } from "./runtime.js";
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
        "Agent Memory Protocol (AMP) substrate — init, doctor, capture, consolidate, retrieve, propagate, projection, knowledge, runtime, agent setup"
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
      "Knowledge backend: gbrain (live), fake-gbrain (test-only), in-memory; omit for local persistent knowledge.db"
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
      "Knowledge backend: gbrain (live), fake-gbrain (test-only), in-memory; omit for local persistent knowledge.db"
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

  const knowledge = amp
    .command("knowledge")
    .description("Local knowledge storage inspection (read-only)");

  knowledge
    .command("status")
    .description("Report local knowledge.db frame counts and paths (read-only, no gbrain)")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--json", "Emit JSON instead of human-readable report")
    .action((opts: { projectRoot?: string; json?: boolean }) => {
      const result = runAmpKnowledgeStatus({ projectRoot: opts.projectRoot });
      writeAmpRuntimeCliResult({
        result,
        json: opts.json,
        formatJson: formatAmpKnowledgeStatusJson,
        formatReport: formatAmpKnowledgeStatusReport,
      });
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  knowledge
    .command("list")
    .description("List durable frames from local knowledge.db (read-only, no gbrain)")
    .option("--project-root <path>", "Project root (default: current directory)")
    .option("--json", "Emit JSON instead of human-readable report")
    .option("--kind <frame-kind>", "Filter by frame kind: episodic, semantic, or crystal")
    .option("--scope <scope-kind>", "Filter by scope kind: project, user, or universal")
    .option("--limit <n>", "Maximum frames to return (default: 20)")
    .action(
      (opts: {
        projectRoot?: string;
        json?: boolean;
        kind?: string;
        scope?: string;
        limit?: string;
      }) => {
        const result = runAmpKnowledgeList({
          projectRoot: opts.projectRoot,
          kind: opts.kind,
          scope: opts.scope,
          limit: opts.limit,
        });
        writeAmpRuntimeCliResult({
          result,
          json: opts.json,
          formatJson: formatAmpKnowledgeListJson,
          formatReport: formatAmpKnowledgeListReport,
        });
        if (!result.ok) {
          process.exitCode = 1;
        }
      },
    );

  registerAmpRuntimeCommands(amp);

  amp
    .command("status")
    .description("Show AMP CLI shell status")
    .action(() => {
      process.stdout.write(`AMP CLI shell v${AMP_CLI_SHELL_VERSION}\n`);
      process.stdout.write(
        "Wired: init, doctor, gbrain-preflight, capture, consolidate, retrieve, propagate (consolidate defaults to local persistent knowledge.db; explicit gbrain/fake-gbrain/in-memory via --knowledge), projection render (placeholder dry-run; local source with --source local reads persistent knowledge.db; gbrain read-only source with --source gbrain), knowledge status/list (read-only local knowledge.db summary and frame listing), runtime status/inspect/seed/correct/graduation plan/apply (typed entity inspect/seed/correct on local storage; read-only graduation review; graduation apply writes durable local knowledge), agent setup (claude-code, cursor, and codex dry-run/apply). Offline acceptance (`npm run amp:acceptance`) includes the durable local capture → consolidate → retrieve → projection loop against isolated knowledge.db.\n"
      );
    });

  return amp;
}
