/**
 * AMP filesystem projection schema (v1.5 design).
 *
 * @module amp/projection
 */

export {
  AMP_PROJECTION_ARTIFACT_VERSION,
  DEFAULT_COMBINED_TOKEN_BUDGET,
  DEFAULT_FILE_TOKEN_TARGET_SUM,
  DEFAULT_FILE_TOKEN_TARGETS,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  PROJECTION_TRUNCATION_MARKER,
  type ProjectionFileKind,
} from "./constants.js";

export {
  AMP_USER_ROOT_DIR,
  GLOBAL_PROJECTION_REL,
  GLOBAL_RUNTIME_REL,
  PROJECT_LOCAL_DIR,
  PROJECT_PROJECTION_FILENAME,
  PROJECT_RUNTIME_FILENAME,
  projectionFilePath,
  type PathContext as ProjectionPathContext,
} from "./paths.js";

export {
  PROJECTION_FILE_SPECS,
  ProjectionBudgetMetadataSchema,
  ProjectionBudgetStatusSchema,
  ProjectionCadenceSchema,
  ProjectionDocumentSchema,
  ProjectionFileKindSchema,
  ProjectionMetadataHeaderSchema,
  ProjectionScopeSchema,
  ProjectionSourceStoreSchema,
  createProjectionDocument,
  parseProjectionDocument,
  safeParseProjectionDocument,
  type CreateProjectionDocumentOptions,
  type ProjectionBudgetMetadata,
  type ProjectionBudgetStatus,
  type ProjectionCadence,
  type ProjectionDocument,
  type ProjectionDocumentParseResult,
  type ProjectionFileSpec,
  type ProjectionMetadataHeader,
  type ProjectionScope,
  type ProjectionSourceStore,
} from "./schema.js";
