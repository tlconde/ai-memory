import { readFile } from "fs/promises";
import { join } from "path";
import yaml from "js-yaml";
import { AI_PATHS } from "../schema-constants.js";

/** Regex rules only. Which lines to scan: additions (default), deletions, or both. */
export type RuleScope = "additions" | "deletions" | "all";

export interface ConstraintPattern {
  type: "ast" | "regex";
  language?: string;
  pattern: string;
  where?: Record<string, { regex: string }>;
  path: string;
  /** Regex only. Default: "additions". Use "deletions" for rules like "don't remove [P0] markers". */
  scope?: RuleScope;
  message?: string;
}

export interface HarnessRule {
  id: string;
  type: "ast" | "regex";
  language?: string;
  pattern: string;
  where?: Record<string, { regex: string }>;
  path: string;
  scope?: RuleScope;
  severity: "P0" | "P1" | "P2";
  message: string;
}

export interface RuleTest {
  rule_id: string;
  should_trigger: string;
  should_not_trigger: string;
}

export interface P0Entry {
  id: string;
  title: string;
  body: string;
  constraint_pattern?: ConstraintPattern;
}

// Parse [P0] entries from a multi-entry memory file.
// Entries are markdown sections starting with ### [P0], ### [P1], or ### [P2]
export function parseMemoryEntries(
  content: string,
  fileId: string
): P0Entry[] {
  const entries: P0Entry[] = [];
  // Split on section headings ### [Px] Title
  const sectionRegex = /^### \[(P0|P1|P2)\] (.+)$/gm;
  const sections: Array<{ priority: string; title: string; start: number }> =
    [];

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({
      priority: match[1],
      title: match[2].trim(),
      start: match.index,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const end =
      i + 1 < sections.length ? sections[i + 1].start : content.length;
    const body = content.slice(section.start, end).trim();

    if (section.priority !== "P0") continue;

    // Extract constraint_pattern from inline YAML block if present
    // Format: ```yaml\nconstraint_pattern:\n  ...\n```
    let constraint_pattern: ConstraintPattern | undefined;
    const yamlBlockMatch = body.match(
      /```yaml\s*\nconstraint_pattern:\s*\n([\s\S]*?)```/
    );
    if (yamlBlockMatch) {
      try {
        const parsed = yaml.load(
          `constraint_pattern:\n${yamlBlockMatch[1]}`,
          { schema: yaml.JSON_SCHEMA }
        ) as { constraint_pattern: ConstraintPattern };
        constraint_pattern = parsed.constraint_pattern;
      } catch {
        // malformed yaml block — skip pattern
      }
    }

    const slug = section.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const id = `${fileId}-${slug}`;

    entries.push({
      id,
      title: section.title,
      body,
      constraint_pattern,
    });
  }

  return entries;
}

// Read all [P0] entries from decisions.md and debugging.md
export async function readP0Entries(aiDir: string): Promise<P0Entry[]> {
  const files = [AI_PATHS.DECISIONS, AI_PATHS.DEBUGGING];
  const entries: P0Entry[] = [];

  for (const file of files) {
    const path = join(aiDir, file);
    try {
      const content = await readFile(path, "utf-8");
      const fileId = file.replace("memory/", "").replace(".md", "");
      entries.push(...parseMemoryEntries(content, fileId));
    } catch {
      // file may not exist yet — skip
    }
  }

  return entries;
}

// Compile [P0] entries with constraint_pattern into harness rules
export function compileHarnessRules(entries: P0Entry[]): HarnessRule[] {
  return entries
    .filter((e) => e.constraint_pattern !== undefined)
    .map((e) => {
      const cp = e.constraint_pattern!;
      return {
        id: e.id,
        type: cp.type,
        language: cp.language,
        pattern: cp.pattern,
        where: cp.where,
        path: cp.path,
        scope: cp.scope,
        severity: "P0",
        message:
          cp.message ??
          `[P0] Constraint violation: ${e.title} (${e.id})`,
      };
    });
}

// Generate rule tests for each harness rule that has examples in the entry body
export function generateRuleTests(entries: P0Entry[]): RuleTest[] {
  const tests: RuleTest[] = [];

  for (const entry of entries) {
    if (!entry.constraint_pattern) continue;

    // Look for example blocks: **Should trigger:** and **Should not trigger:**
    const triggerMatch = entry.body.match(
      /\*\*Should trigger:\*\*\s*```[^\n]*\n([\s\S]*?)```/
    );
    const noTriggerMatch = entry.body.match(
      /\*\*Should not trigger:\*\*\s*```[^\n]*\n([\s\S]*?)```/
    );

    if (triggerMatch && noTriggerMatch) {
      tests.push({
        rule_id: entry.id,
        should_trigger: triggerMatch[1].trim(),
        should_not_trigger: noTriggerMatch[1].trim(),
      });
    }
  }

  return tests;
}
