import { readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { minimatch } from "minimatch";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  readP0Entries,
  compileHarnessRules,
  generateRuleTests,
  type HarnessRule,
} from "../../governance/p0-parser.js";
import { VALID_TYPES, VALID_STATUSES } from "../../schema-constants.js";
import { getRepoRoot, MAX_GIT_DIFF_BYTES, AI_PATHS, textResponse, type McpResponse } from "./shared.js";

// Parse diff into sections with file path and added/deleted lines
function parseDiffSections(diff: string): Array<{ path: string; addedLines: string; deletedLines: string }> {
  const sections: Array<{ path: string; addedLines: string; deletedLines: string }> = [];
  const parts = diff.split(/^diff --git /m).slice(1);
  for (const part of parts) {
    const fileMatch = part.match(/^[^\n]*b\/(.+)$/m);
    if (!fileMatch) continue;
    const path = fileMatch[1].trim();
    const addedLines = part.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
    const deletedLines = part.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)).join("\n");
    sections.push({ path, addedLines, deletedLines });
  }
  return sections;
}

export interface ValidationResult {
  violations: Array<{ rule_id: string; message: string; severity: string }>;
  audit: Array<{ rule_id: string; path: string; status: "passed" | "failed" | "skipped" }>;
}

async function validateDiff(
  diff: string,
  rules: HarnessRule[],
  aiDir: string,
  repoRoot: string | null
): Promise<ValidationResult> {
  const sections = parseDiffSections(diff);
  const violations: Array<{ rule_id: string; message: string; severity: string }> = [];
  const audit: Array<{ rule_id: string; path: string; status: "passed" | "failed" | "skipped" }> = [];

  for (const rule of rules) {
    const pathGlob = rule.path || "**/*";
    const matchingSections = sections.filter((s) => {
      const relPath = repoRoot ? s.path : s.path;
      return minimatch(relPath, pathGlob, { dot: true });
    });

    if (matchingSections.length === 0) {
      audit.push({ rule_id: rule.id, path: pathGlob, status: "skipped" });
      continue;
    }

    if (rule.type === "regex") {
      const scope = rule.scope || "additions";
      let content = "";
      for (const section of matchingSections) {
        if (scope === "additions") content += section.addedLines + "\n";
        else if (scope === "deletions") content += section.deletedLines + "\n";
        else content += section.addedLines + "\n" + section.deletedLines + "\n";
      }

      try {
        const regex = new RegExp(rule.pattern, "gm");
        if (regex.test(content)) {
          violations.push({ rule_id: rule.id, message: rule.message, severity: rule.severity });
          audit.push({ rule_id: rule.id, path: pathGlob, status: "failed" });
        } else {
          audit.push({ rule_id: rule.id, path: pathGlob, status: "passed" });
        }
      } catch {
        violations.push({
          rule_id: rule.id,
          message: `${rule.message} (invalid regex pattern — manual review required)`,
          severity: rule.severity,
        });
        audit.push({ rule_id: rule.id, path: pathGlob, status: "failed" });
      }
    } else if (rule.type === "ast") {
      try {
        const { parse } = await import("@ast-grep/napi");
        const lang = rule.language || "typescript";

        let matcher: string | { rule: { pattern: string }; constraints: Record<string, { regex: string }> };
        if (rule.where) {
          matcher = { rule: { pattern: rule.pattern }, constraints: rule.where };
        } else {
          matcher = rule.pattern;
        }

        let found = false;
        for (const section of matchingSections) {
          const addedCode = section.addedLines;
          if (!addedCode.trim()) continue;
          const tree = parse(lang as Parameters<typeof parse>[0], addedCode);
          const sgRoot = tree.root();
          const matches = typeof matcher === "string"
            ? sgRoot.findAll(matcher)
            : sgRoot.findAll(matcher as { rule: { pattern: string }; constraints: Record<string, { regex: string }> });
          if (matches.length > 0) {
            found = true;
            violations.push({ rule_id: rule.id, message: rule.message, severity: rule.severity });
            audit.push({ rule_id: rule.id, path: pathGlob, status: "failed" });
            break;
          }
        }
        if (!found) {
          audit.push({ rule_id: rule.id, path: pathGlob, status: "passed" });
        }
      } catch {
        violations.push({
          rule_id: rule.id,
          message: `${rule.message} (ast-grep unavailable — manual review required)`,
          severity: rule.severity,
        });
        audit.push({ rule_id: rule.id, path: pathGlob, status: "failed" });
      }
    }
  }

  return { violations, audit };
}

function validateEntrySchema(entry: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const required = ["id", "type", "status"];
  for (const field of required) {
    if (!entry[field]) errors.push(`Missing required field: ${field}`);
  }
  if (entry.type && !(VALID_TYPES as readonly string[]).includes(entry.type as string)) {
    errors.push(`Invalid type: ${entry.type}. Must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (entry.status && !(VALID_STATUSES as readonly string[]).includes(entry.status as string)) {
    errors.push(`Invalid status: ${entry.status}. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  return errors;
}

export async function handleValidateContext(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const gitDiffRaw = args.git_diff;
  if (typeof gitDiffRaw !== "string" || !gitDiffRaw.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "git_diff is required and must be a non-empty string.");
  }
  const gitDiffSize = Buffer.byteLength(gitDiffRaw, "utf-8");
  if (gitDiffSize > MAX_GIT_DIFF_BYTES) {
    throw new McpError(ErrorCode.InvalidParams, `git_diff exceeds ${MAX_GIT_DIFF_BYTES / 1024}KB limit (got ${Math.round(gitDiffSize / 1024)}KB). Trim the diff or validate in chunks.`);
  }
  const harnessPath = join(aiDir, AI_PATHS.HARNESS);
  if (!existsSync(harnessPath)) {
    return textResponse("No harness.json found. Run generate_harness to create one, or initialize with --full.");
  }
  let rules: HarnessRule[];
  try {
    const harnessRaw = await readFile(harnessPath, "utf-8");
    rules = JSON.parse(harnessRaw);
  } catch {
    throw new McpError(ErrorCode.InternalError, "Failed to parse harness.json. Run `ai-memory generate-harness` to regenerate.");
  }
  const repoRoot = getRepoRoot(resolve(aiDir, ".."));
  const { violations, audit } = await validateDiff(gitDiffRaw, rules, aiDir, repoRoot);

  const timestamp = new Date().toISOString();
  const harnessVersion = "1.0";

  if (violations.length === 0) {
    const auditLines = audit.map((a) => {
      const icon = a.status === "passed" ? "✓" : a.status === "skipped" ? "○" : "✗";
      return `  ${icon} [P0] ${a.rule_id} (${a.path}) — ${a.status}`;
    });
    const cert = [
      "═══ Stability Certificate ═══",
      `Status: PASSED`,
      `Harness: ${harnessVersion} | ${timestamp}`,
      `repo_root: ${repoRoot ?? "null"}`,
      "",
      "Audit log:",
      ...auditLines,
      "",
      "Stability Surface is 100% compliant with active [P0] constraints.",
    ].join("\n");
    return textResponse(cert);
  }

  const p0Violations = violations.filter((v) => v.severity === "P0");
  if (p0Violations.length > 0) {
    const report = [
      "═══ Constraint Violation Report ═══",
      `Status: FAILED`,
      `Harness: ${harnessVersion} | ${timestamp}`,
      `repo_root: ${repoRoot ?? "null"}`,
      "",
      `[HARD BLOCK] ${p0Violations.length} P0 constraint violation(s):`,
      "",
      ...p0Violations.map((v) => `• ${v.rule_id}: ${v.message}`),
    ].join("\n");
    throw new McpError(ErrorCode.InvalidRequest, report);
  }

  const text = violations.map((v) => `• [${v.severity}] ${v.rule_id}: ${v.message}`).join("\n");
  return textResponse(`Constraint warnings:\n\n${text}`, true);
}

export async function handleValidateSchema(_aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const entry = args.entry;
  if (!entry || typeof entry !== "object") {
    throw new McpError(ErrorCode.InvalidParams, "entry is required and must be an object.");
  }
  const errors = validateEntrySchema(entry as Record<string, unknown>);
  if (errors.length === 0) return textResponse("✓ Schema valid.");
  throw new McpError(ErrorCode.InvalidParams, `Schema validation failed:\n\n${errors.map((e) => `• ${e}`).join("\n")}`);
}

export async function handleGenerateHarness(aiDir: string): Promise<McpResponse> {
  const entries = await readP0Entries(aiDir);
  const rules = compileHarnessRules(entries);
  const tests = generateRuleTests(entries);

  const tempDir = join(aiDir, "temp");
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, "harness.json"), JSON.stringify(rules, null, 2));

  if (tests.length > 0) {
    const testsDir = join(tempDir, "rule-tests");
    await mkdir(testsDir, { recursive: true });
    await writeFile(join(testsDir, "tests.json"), JSON.stringify(tests, null, 2));
  }

  const harnessOk = `✓ Governance gate active: ${rules.length} rule(s) compiled from ${entries.length} [P0] entries. Run validate_context with your git diff to enforce.`;
  const testsLine = tests.length > 0
    ? `✓ Rule tests: ${tests.length} test(s) written to temp/rule-tests/tests.json`
    : `○ Rule tests: none (optional). Add **Should trigger:** and **Should not trigger:** to [P0] entries to generate tests.`;
  return textResponse(`${harnessOk}\n${testsLine}`);
}
