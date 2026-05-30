/**
 * Shape A dogfood readiness checks for `amp doctor` (read-only).
 *
 * Falsifiable claim: doctor reports walkthrough-aligned assertions for local
 * persistent knowledge, projection artifacts, and harness wiring without writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CURSOR_FROM_AMP_REL } from "../../adapters/sas/cursor/adapter.js";
import {
  CLAUDE_PROJECT_FILENAME,
  inspectClaudeCodeMarkerBlock,
} from "../../agent-setup/claude-code.js";
import { CURSOR_PROJECTION_RULE_FILENAME } from "../../agent-setup/cursor.js";
import { checkAmpGitignoreProtection } from "../../gitignore/check.js";
import { projectProjectionPath, projectRuntimePath } from "../../projection/paths.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "../knowledge-backend.js";
import { runAmpKnowledgeList } from "../knowledge-list.js";
import { resolveAmpRuntimeCliBootstrap } from "../runtime-cli-bootstrap.js";
import type { AmpDoctorFinding } from "../doctor.js";

const CATEGORY = "dogfood-ready";

const MATERIALIZE_COMMAND =
  "Run `amp projection render --source local --apply` to materialize project projection files.";
const CONSOLIDATE_COMMAND =
  "Run `amp consolidate` after capture to write durable frames to knowledge.db.";
const SETUP_COMMAND_CLAUDE =
  "Run `amp agent setup --target claude-code --apply` to wire Claude @ imports.";
const SETUP_COMMAND_CURSOR =
  "Run `amp agent setup --target cursor --apply` to inline Cursor projection rules.";

export interface AppendDogfoodReadyFindingsOptions {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  configExists: boolean;
}

export interface DogfoodReadyRollup {
  ready: boolean;
  blockers: string[];
}

function finding(
  level: AmpDoctorFinding["level"],
  message: string
): AmpDoctorFinding {
  return { level, category: CATEGORY, message };
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf8");
}

function isNonEmptyFile(path: string): boolean {
  const content = readOptionalFile(path);
  return content !== undefined && content.trim().length > 0;
}

function isShapeASafeKnowledgeBackend(env: NodeJS.ProcessEnv): boolean {
  const backend = env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim();
  return !backend;
}

/** Evaluate Shape A dogfood rollup from collected blockers (test helper). */
export function evaluateDogfoodReadyRollup(blockers: string[]): DogfoodReadyRollup {
  return {
    ready: blockers.length === 0,
    blockers: [...blockers],
  };
}

/** Append read-only Shape A dogfood readiness findings and rollup line. */
export function appendDogfoodReadyFindings(
  findings: AmpDoctorFinding[],
  options: AppendDogfoodReadyFindingsOptions
): DogfoodReadyRollup {
  const env = options.env ?? process.env;
  const blockers: string[] = [];

  if (!options.configExists) {
    findings.push(
      finding(
        "warning",
        "Shape A dogfood checks require project config — run `amp init` first."
      )
    );
    findings.push(finding("info", "dogfood_ready: false — project config missing."));
    return { ready: false, blockers: ["project-config"] };
  }

  if (!isShapeASafeKnowledgeBackend(env)) {
    const backend = env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim() ?? "";
    findings.push(
      finding(
        "warning",
        `AMP_KNOWLEDGE_BACKEND=${backend} — Shape A local dogfood expects unset env for persistent knowledge.db. Unset ${AMP_KNOWLEDGE_BACKEND_ENV}.`
      )
    );
    blockers.push("knowledge-backend-env");
  } else {
    findings.push(
      finding(
        "ok",
        `${AMP_KNOWLEDGE_BACKEND_ENV} unset — consolidate defaults to local persistent knowledge.db (Shape A).`
      )
    );
  }

  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env,
    homedir: options.homedir,
  });

  if (!bootstrap.ok) {
    findings.push(
      finding(
        "warning",
        `Could not resolve runtime paths for knowledge checks: ${bootstrap.error}`
      )
    );
    blockers.push("runtime-bootstrap");
  } else {
    const knowledgeList = runAmpKnowledgeList({
      projectRoot: options.projectRoot,
      env,
      homedir: options.homedir,
      runtimeDbPath: bootstrap.runtimeDbPath,
      limit: 1,
    });

    if (!knowledgeList.knowledgeDbExists) {
      findings.push(
        finding(
          "warning",
          `No durable knowledge.db beside runtime.db yet. ${CONSOLIDATE_COMMAND}`
        )
      );
      blockers.push("knowledge-db");
    } else {
      findings.push(
        finding("ok", `Local knowledge.db present at ${knowledgeList.knowledgeDbPath}.`)
      );
    }

    if (knowledgeList.knowledgeDbExists && knowledgeList.totalReturned < 1) {
      findings.push(
        finding(
          "warning",
          "knowledge.db has no consolidated frames yet. Capture a preference, then consolidate."
        )
      );
      blockers.push("knowledge-frames");
    } else if (knowledgeList.totalReturned >= 1) {
      findings.push(
        finding(
          "ok",
          `At least one durable knowledge frame present (listed ${knowledgeList.totalReturned}).`
        )
      );
    }
  }

  const projectionPath = projectProjectionPath(options.projectRoot);
  const runtimePath = projectRuntimePath(options.projectRoot);

  if (!isNonEmptyFile(projectionPath)) {
    findings.push(
      finding(
        "warning",
        `.amp/local/projection.md missing or empty. ${MATERIALIZE_COMMAND}`
      )
    );
    blockers.push("projection-md");
  } else {
    findings.push(finding("ok", ".amp/local/projection.md present with content."));
  }

  if (!isNonEmptyFile(runtimePath)) {
    findings.push(
      finding(
        "warning",
        `.amp/local/runtime.md missing or empty. ${MATERIALIZE_COMMAND}`
      )
    );
    blockers.push("runtime-md");
  } else {
    findings.push(finding("ok", ".amp/local/runtime.md present with content."));
  }

  const gitignore = checkAmpGitignoreProtection(options.projectRoot);
  if (!gitignore.insideGitWorkTree) {
    findings.push(
      finding(
        "info",
        "Project is not inside a git work tree — Invariant 6 gitignore check skipped; dogfood_ready requires a git repo (walkthrough Step 7 prep)."
      )
    );
    blockers.push("git-worktree");
  } else if (gitignore.trackablePaths.length > 0) {
    findings.push(
      finding(
        "error",
        `Tracked AMP-managed paths break Invariant 6: ${gitignore.trackablePaths.join(", ")}.`
      )
    );
    blockers.push("gitignore-tracked");
  } else if (gitignore.unprotectedPaths.length > 0) {
    findings.push(
      finding(
        "warning",
        `.gitignore missing AMP entries for ${gitignore.unprotectedPaths.join(", ")}. Run \`amp init\`.`
      )
    );
    blockers.push("gitignore-entries");
  } else {
    findings.push(finding("ok", "AMP-managed paths are git-ignored (Invariant 6)."));
  }

  const claudeContent = readOptionalFile(join(options.projectRoot, CLAUDE_PROJECT_FILENAME));
  if (!claudeContent) {
    findings.push(
      finding(
        "warning",
        `${CLAUDE_PROJECT_FILENAME} has no AMP marker block yet. ${SETUP_COMMAND_CLAUDE}`
      )
    );
    blockers.push("claude-wiring");
  } else {
    const marker = inspectClaudeCodeMarkerBlock(claudeContent);
    if (marker.malformed) {
      findings.push(
        finding(
          "error",
          `${CLAUDE_PROJECT_FILENAME} AMP marker block is malformed. Re-run Claude agent setup with --apply.`
        )
      );
      blockers.push("claude-wiring");
    } else if (!marker.present) {
      findings.push(
        finding(
          "warning",
          `${CLAUDE_PROJECT_FILENAME} exists but lacks AMP @ imports. ${SETUP_COMMAND_CLAUDE}`
        )
      );
      blockers.push("claude-wiring");
    } else {
      findings.push(
        finding(
          "ok",
          `${CLAUDE_PROJECT_FILENAME} contains AMP @ imports for .amp/local projection files.`
        )
      );
    }
  }

  const cursorRulePath = join(
    options.projectRoot,
    CURSOR_FROM_AMP_REL,
    CURSOR_PROJECTION_RULE_FILENAME
  );
  if (!isNonEmptyFile(cursorRulePath)) {
    findings.push(
      finding(
        "warning",
        `${join(CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)} missing or empty. ${SETUP_COMMAND_CURSOR}`
      )
    );
    blockers.push("cursor-wiring");
  } else {
    findings.push(
      finding(
        "ok",
        `${join(CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)} present with inlined projection context.`
      )
    );
  }

  const rollup = evaluateDogfoodReadyRollup(blockers);
  const hasDogfoodErrors = findings.some(
    (item) => item.category === CATEGORY && item.level === "error"
  );

  if (rollup.ready && !hasDogfoodErrors) {
    findings.push(
      finding(
        "info",
        "dogfood_ready: true — Shape A filesystem path is wired (walkthrough Steps 1–5 + Invariant 6 git repo). Live harness session load remains PROVISIONAL (Step 6)."
      )
    );
  } else {
    const blockerSummary =
      rollup.blockers.length > 0 ? rollup.blockers.join(", ") : "see ERROR items above";
    findings.push(
      finding("info", `dogfood_ready: false — blockers: ${blockerSummary}.`)
    );
  }

  return rollup;
}
