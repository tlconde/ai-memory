/**
 * Structured content inputs for building projection document bodies.
 *
 * Falsifiable claim: a ProjectionContentModel renders deterministic markdown
 * sections from ordered text blocks without DB reads or filesystem writes.
 */

export interface ProjectionTextBlock {
  id: string;
  label: string;
  priority: number;
  tokenEstimate: number;
  text: string;
}

export interface ProjectionContentSection {
  blocks: ProjectionTextBlock[];
}

export interface ProjectionContentModel {
  projectRef: string;
  globalProjection: ProjectionContentSection;
  globalRuntime: ProjectionContentSection;
  projectProjection: ProjectionContentSection;
  projectRuntime: ProjectionContentSection;
}

export type ProjectionContentSectionKey = keyof Omit<ProjectionContentModel, "projectRef">;

const SECTION_HEADINGS: Record<ProjectionContentSectionKey, string> = {
  globalProjection: "Global projection",
  globalRuntime: "Global runtime",
  projectProjection: "Project projection",
  projectRuntime: "Project runtime",
};

/** Estimate token count from plain text (deterministic metadata-only heuristic). */
export function estimateProjectionTextTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function emptySection(): ProjectionContentSection {
  return { blocks: [] };
}

/** Build an empty projection content model for a project_ref. */
export function createEmptyProjectionContentModel(projectRef: string): ProjectionContentModel {
  return {
    projectRef,
    globalProjection: emptySection(),
    globalRuntime: emptySection(),
    projectProjection: emptySection(),
    projectRuntime: emptySection(),
  };
}

/** Sort blocks by priority ascending, then id ascending. */
export function sortProjectionTextBlocks(
  blocks: readonly ProjectionTextBlock[]
): ProjectionTextBlock[] {
  return [...blocks].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.id.localeCompare(right.id);
  });
}

/** Sum tokenEstimate across blocks in a section. */
export function sumSectionTokenEstimate(section: ProjectionContentSection): number {
  return section.blocks.reduce((sum, block) => sum + block.tokenEstimate, 0);
}

export interface RenderProjectionSectionOptions {
  projectRef?: string;
}

/** Render one content section to a markdown body string. */
export function renderProjectionContentSection(
  sectionKey: ProjectionContentSectionKey,
  section: ProjectionContentSection,
  options: RenderProjectionSectionOptions = {}
): string {
  const heading = SECTION_HEADINGS[sectionKey];
  const lines: string[] = [`# ${heading}`, ""];

  if (options.projectRef) {
    lines.push(`_Project: ${options.projectRef}_`, "");
  }

  const blocks = sortProjectionTextBlocks(section.blocks);
  if (blocks.length === 0) {
    lines.push("_No content yet._", "");
    return lines.join("\n");
  }

  for (const block of blocks) {
    lines.push(`## ${block.label}`, "", block.text, "");
  }

  return lines.join("\n");
}

/** Render all four sections from a content model to markdown body strings. */
export function renderProjectionContentModel(model: ProjectionContentModel): Record<
  ProjectionContentSectionKey,
  string
> {
  return {
    globalProjection: renderProjectionContentSection(
      "globalProjection",
      model.globalProjection
    ),
    globalRuntime: renderProjectionContentSection("globalRuntime", model.globalRuntime),
    projectProjection: renderProjectionContentSection(
      "projectProjection",
      model.projectProjection,
      { projectRef: model.projectRef }
    ),
    projectRuntime: renderProjectionContentSection("projectRuntime", model.projectRuntime, {
      projectRef: model.projectRef,
    }),
  };
}
