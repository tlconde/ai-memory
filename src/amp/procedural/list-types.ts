import type { CanonicalProcedure } from "./schema.js";

export interface ProceduralListEntry {
  name: string;
  version: string;
  supported_harnesses: string[];
  validation_error?: string;
  frontmatter?: CanonicalProcedure["frontmatter"];
}

export interface ProceduralListResult {
  entries: ProceduralListEntry[];
}
