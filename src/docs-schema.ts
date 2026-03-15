/**
 * Documentation schema: canonical paths, naming conventions, validation.
 * Used by get_doc_path, validate_doc_placement, and validate-docs CLI.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export interface DocTypeConfig {
  path: string;
  pattern: string;
}

export interface DocsSchema {
  version?: number;
  namingConvention?: "SCREAMING_SNAKE" | "kebab-case" | "PascalCase" | "custom";
  strict?: boolean;
  docTypes: Record<string, DocTypeConfig>;
}

const DEFAULT_SCHEMA: DocsSchema = {
  version: 1,
  namingConvention: "SCREAMING_SNAKE",
  strict: false,
  docTypes: {
    "design-system": { path: "docs/architecture", pattern: "*_GLOBAL_DESIGN_SYSTEM.md" },
    adr: { path: "docs/architecture/adr", pattern: "ADR-{seq:03d}-*.md" },
    "api-spec": { path: "docs/api", pattern: "OPENAPI_SPEC.yaml" },
    "api-guide": { path: "docs/guides", pattern: "*_API_GUIDE.md" },
    "model-card": { path: "docs/ai/model-cards", pattern: "*_MODEL_CARD.md" },
    prompts: { path: "docs/ai/prompts", pattern: "*_PROMPTS.md" },
    backlog: { path: "docs", pattern: "BACKLOG.md" },
    "decisions-archive": { path: "docs/archive", pattern: "DECISIONS_AND_LESSONS_LEARNED.md" },
    changelog: { path: "docs/archive", pattern: "CHANGELOG.md" },
  },
};

export async function loadDocsSchema(projectRoot: string): Promise<DocsSchema | null> {
  const schemaPath = join(projectRoot, ".ai", "docs-schema.json");
  if (!existsSync(schemaPath)) return null;
  try {
    const raw = await readFile(schemaPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DocsSchema>;
    return {
      ...DEFAULT_SCHEMA,
      ...parsed,
      docTypes: { ...DEFAULT_SCHEMA.docTypes, ...parsed.docTypes },
    };
  } catch {
    return null;
  }
}

export function getDocPath(schema: DocsSchema, type: string, slug?: string): string | null {
  const config = schema.docTypes[type];
  if (!config) return null;
  const basePath = config.path;
  // Resolve pattern to concrete filename
  const pattern = config.pattern;
  if (pattern.includes("{seq")) {
    // ADR: need next seq or slug — for now return dir + example
    return join(basePath, pattern.replace("{seq:03d}-*", slug ? `001-${slug}` : "001-slug"));
  }
  if (pattern.startsWith("*")) {
    const suffix = pattern.slice(1);
    return slug ? join(basePath, `${slug}${suffix}`) : join(basePath, `<NAME>${suffix}`);
  }
  return join(basePath, pattern);
}

/** SCREAMING_SNAKE: A-Z, digits, underscores only (e.g. BACKLOG.md, MY_DOC.md) */
const SCREAMING_SNAKE_REGEX = /^[A-Z][A-Z0-9_]*(\.[a-z0-9]+)?$/;

export function validateDocPlacement(
  schema: DocsSchema,
  filePath: string,
  projectRoot: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const convention = schema.namingConvention ?? "SCREAMING_SNAKE";

  // Only validate files under docs/ or .ai/ (excluding .ai/memory which has its own conventions)
  const isDocsDir = normalized.startsWith("docs/");
  const isAiDir = normalized.startsWith(".ai/") && !normalized.startsWith(".ai/memory/");
  if (!isDocsDir && !isAiDir) return { valid: true, errors: [] };

  const basename = normalized.split("/").pop() ?? "";
  if (convention === "SCREAMING_SNAKE") {
    if (!SCREAMING_SNAKE_REGEX.test(basename)) {
      errors.push(
        `Filename "${basename}" should use SCREAMING_SNAKE_CASE (e.g. BACKLOG.md, CHANGELOG.md, MY_DOCUMENT.md)`
      );
    }
  }

  if (schema.strict) {
    const knownPaths = Object.values(schema.docTypes).map((c) => c.path);
    const underKnown = knownPaths.some((p) => normalized.startsWith(p));
    if (!underKnown && isDocsDir) {
      errors.push(
        `Path "${filePath}" is not under a known doc type. Add to .ai/docs-schema.json or use get_doc_path.`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

export function listDocTypes(schema: DocsSchema): Array<{ type: string; path: string; pattern: string }> {
  return Object.entries(schema.docTypes).map(([type, config]) => ({
    type,
    path: config.path,
    pattern: config.pattern,
  }));
}

export const DEFAULT_DOCS_SCHEMA_JSON = JSON.stringify(
  {
    version: 1,
    namingConvention: "SCREAMING_SNAKE",
    strict: false,
    docTypes: DEFAULT_SCHEMA.docTypes,
  },
  null,
  2
);
