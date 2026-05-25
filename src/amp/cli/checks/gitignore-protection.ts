import { checkAmpGitignoreProtection } from "../../gitignore/check.js";
import { DEFAULT_AMP_GITIGNORE_LINES } from "../../gitignore/paths.js";
import type { AmpDoctorFinding } from "../doctor.js";

const CATEGORY = "gitignore-protection";

function finding(
  level: AmpDoctorFinding["level"],
  message: string
): AmpDoctorFinding {
  return { level, category: CATEGORY, message };
}

/** Append gitignore protection findings for AMP-managed project-local paths. */
export function appendGitignoreProtectionFindings(
  findings: AmpDoctorFinding[],
  projectRoot: string
): void {
  const result = checkAmpGitignoreProtection(projectRoot);

  if (!result.insideGitWorkTree) {
    findings.push(
      finding(
        "info",
        "Project is not inside a git work tree; skipping AMP gitignore verification."
      )
    );
    return;
  }

  if (result.trackablePaths.length > 0) {
    findings.push(
      finding(
        "error",
        `Tracked AMP-managed files must not be in version control: ${result.trackablePaths.join(", ")}. ` +
          "Remove them from the index (for example `git rm --cached`) and ensure " +
          `${DEFAULT_AMP_GITIGNORE_LINES.join(" and ")} are listed in .gitignore.`
      )
    );
    return;
  }

  if (result.unprotectedPaths.length > 0) {
    findings.push(
      finding(
        "warning",
        `.gitignore is missing AMP entries for ${result.unprotectedPaths.join(", ")}. ` +
          "Run `amp init` or add the entries manually."
      )
    );
    return;
  }

  findings.push(
    finding(
      "ok",
      `AMP-managed paths (${DEFAULT_AMP_GITIGNORE_LINES.join(", ")}) are git-ignored.`
    )
  );
}
