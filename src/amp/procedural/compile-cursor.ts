/**
 * Compile canonical AMP procedures into Cursor `.mdc` rules.
 *
 * Falsifiable claim: valid canonical procedures emit deterministic flat
 * `{name}.mdc` files with Cursor frontmatter derived from harness overlays.
 */

import {
  CanonicalProcedureSchema,
  type CanonicalProcedure,
} from "./schema.js";

export class CompileCursorError extends Error {
  override readonly name = "CompileCursorError";

  constructor(message: string) {
    super(message);
  }
}

export interface CompiledCursorMdc {
  filename: string;
  content: string;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function formatGlobs(globs: readonly string[]): string {
  if (globs.length === 0) {
    return "globs: []";
  }

  const lines = [...globs].sort().map((glob) => `  - ${yamlScalar(glob)}`);
  return ["globs:", ...lines].join("\n");
}

function formatFrontmatter(
  description: string,
  globs: readonly string[],
  alwaysApply: boolean
): string {
  return [
    "---",
    `description: ${yamlScalar(description)}`,
    formatGlobs(globs),
    `alwaysApply: ${alwaysApply}`,
    "---",
  ].join("\n");
}

export function compileProcedureToCursorMdc(procedure: CanonicalProcedure): CompiledCursorMdc {
  const parsed = CanonicalProcedureSchema.safeParse(procedure);
  if (!parsed.success) {
    throw new CompileCursorError("Procedure failed schema validation");
  }

  const valid = parsed.data;
  const overlay = valid.frontmatter.harness_overlays.cursor ?? {
    globs: [],
    alwaysApply: false,
  };

  const filename = `${valid.frontmatter.name}.mdc`;
  const frontmatter = formatFrontmatter(
    valid.frontmatter.description,
    overlay.globs,
    overlay.alwaysApply
  );
  const content = `${frontmatter}\n${valid.body}`;

  return { filename, content };
}
