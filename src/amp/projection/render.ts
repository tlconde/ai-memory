/**
 * AMP filesystem projection markdown renderer.
 *
 * Falsifiable claim: identical ProjectionDocument input always yields
 * byte-identical markdown with stable frontmatter key order and round-trip
 * validation through ProjectionDocumentSchema.
 */

import matter from "gray-matter";
import yaml from "js-yaml";

import {
  safeParseProjectionDocument,
  type ProjectionBudgetMetadata,
  type ProjectionDocument,
  type ProjectionDocumentParseResult,
  type ProjectionMetadataHeader,
} from "./schema.js";

function orderedRecord<T extends Record<string, unknown>>(
  value: T,
  keyOrder: readonly (keyof T)[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keyOrder) {
    if (value[key] !== undefined) {
      result[key as string] = value[key];
    }
  }
  return result;
}

function orderedBudget(budget: ProjectionBudgetMetadata): Record<string, unknown> {
  const result = orderedRecord(budget, [
    "token_target",
    "token_count",
    "combined_cap",
    "combined_count",
    "status",
    "truncated",
    "truncation_marker",
  ]);
  return result;
}

function orderedMetadata(metadata: ProjectionMetadataHeader): Record<string, unknown> {
  const baseKeys = [
    "amp_projection_version",
    "kind",
    "scope",
    ...(metadata.scope === "project" ? (["project_ref"] as const) : []),
    "generated_at",
    "source_revision",
    "source_store",
    "cadence",
    "budget",
  ] as const;

  const result = orderedRecord(metadata, baseKeys);
  result.budget = orderedBudget(metadata.budget);
  return result;
}

function serializeFrontmatter(metadata: ProjectionMetadataHeader): string {
  return yaml
    .dump(orderedMetadata(metadata), {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    .trimEnd();
}

function normalizeBodySeparator(body: string): string {
  if (body.length === 0) {
    return "";
  }
  return body.startsWith("\n") ? body : `\n${body}`;
}

/** Render a validated projection document to markdown with YAML frontmatter. */
export function renderProjectionMarkdown(document: ProjectionDocument): string {
  const frontmatterYaml = serializeFrontmatter(document.metadata);
  let content = `---\n${frontmatterYaml}\n---${normalizeBodySeparator(document.body)}`;

  if (!content.endsWith("\n")) {
    content += "\n";
  }

  return content;
}

/** Parse projection markdown and validate against ProjectionDocumentSchema. */
export function parseProjectionMarkdown(content: string): ProjectionDocumentParseResult {
  let parsed;
  try {
    parsed = matter(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: `Invalid projection markdown: ${message}` };
  }

  return safeParseProjectionDocument({
    metadata: parsed.data,
    body: parsed.content,
  });
}
