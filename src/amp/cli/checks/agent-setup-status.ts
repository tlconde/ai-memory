/**
 * Doctor checks for local agent-access setup status (read-only).
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLAUDE_PROJECT_FILENAME,
  CURSOR_PROJECTION_RULE_FILENAME,
  inspectClaudeCodeMarkerBlock,
} from "../../agent-setup/index.js";
import { CURSOR_FROM_AMP_REL } from "../../adapters/sas/cursor/adapter.js";
import {
  PROJECT_LOCAL_DIR,
  PROJECT_PROJECTION_FILENAME,
  PROJECT_RUNTIME_FILENAME,
} from "../../projection/paths.js";
import type { AmpDoctorFinding } from "../doctor.js";

const SETUP_COMMAND_CLAUDE =
  "Run `ai-memory amp agent setup --target claude-code --dry-run` to preview wiring.";
const SETUP_COMMAND_CURSOR =
  "Run `ai-memory amp agent setup --target cursor --dry-run` to preview wiring.";
const MATERIALIZE_COMMAND =
  "Run `ai-memory amp projection render --source local --apply` to materialize project projection files first.";

function finding(
  level: AmpDoctorFinding["level"],
  message: string
): AmpDoctorFinding {
  return { level, category: "agent-setup", message };
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf8");
}

/** Append read-only agent setup findings for Claude Code and Cursor wiring. */
export function appendAgentSetupStatusFindings(
  findings: AmpDoctorFinding[],
  projectRoot: string
): void {
  const projectionPath = join(
    projectRoot,
    PROJECT_LOCAL_DIR,
    PROJECT_PROJECTION_FILENAME
  );
  const runtimePath = join(projectRoot, PROJECT_LOCAL_DIR, PROJECT_RUNTIME_FILENAME);
  const projectionExists = existsSync(projectionPath);
  const runtimeExists = existsSync(runtimePath);

  if (!projectionExists || !runtimeExists) {
    findings.push(
      finding(
        "warning",
        `Project projection files missing under ${PROJECT_LOCAL_DIR}. ${MATERIALIZE_COMMAND}`
      )
    );
  } else {
    findings.push(
      finding("ok", `Project projection files present under ${PROJECT_LOCAL_DIR}.`)
    );
  }

  const claudePath = join(projectRoot, CLAUDE_PROJECT_FILENAME);
  const claudeContent = readOptionalFile(claudePath);
  if (!claudeContent) {
    findings.push(
      finding(
        "warning",
        `${CLAUDE_PROJECT_FILENAME} has no AMP marker block yet. ${SETUP_COMMAND_CLAUDE}`
      )
    );
  } else {
    const marker = inspectClaudeCodeMarkerBlock(claudeContent);
    if (marker.malformed) {
      findings.push(
        finding(
          "error",
          `${CLAUDE_PROJECT_FILENAME} contains a malformed AMP marker block. Fix markers manually or re-run setup with --apply.`
        )
      );
    } else if (marker.present) {
      findings.push(
        finding("ok", `${CLAUDE_PROJECT_FILENAME} contains an AMP marker block for project imports.`)
      );
    } else {
      findings.push(
        finding(
          "warning",
          `${CLAUDE_PROJECT_FILENAME} exists but has no AMP marker block. ${SETUP_COMMAND_CLAUDE}`
        )
      );
    }
  }

  const cursorRulePath = join(
    projectRoot,
    CURSOR_FROM_AMP_REL,
    CURSOR_PROJECTION_RULE_FILENAME
  );
  if (existsSync(cursorRulePath)) {
    findings.push(
      finding(
        "ok",
        `${join(CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)} exists for flattened Cursor projection context.`
      )
    );
  } else {
    findings.push(
      finding(
        "warning",
        `${join(CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)} missing. ${SETUP_COMMAND_CURSOR}`
      )
    );
  }
}
