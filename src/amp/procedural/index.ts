/**
 * Canonical AMP procedure source schema.
 *
 * @module amp/procedural
 */

export const AMP_PROCEDURAL_MODULE_VERSION = "1.0.0";

export {
  CompileCursorError,
  compileProcedureToCursorMdc,
  type CompiledCursorMdc,
} from "./compile-cursor.js";

export {
  AMP_PROCEDURE_ARTIFACT_VERSION,
  AmpCompatibilitySchema,
  CanonicalProcedureSchema,
  CursorHarnessOverlaySchema,
  GbrainHarnessOverlaySchema,
  HarnessCompatibilitySchema,
  HarnessOverlaysSchema,
  InjectionPathSchema,
  ProcedureConflictSchema,
  ProcedureCurationModeSchema,
  ProcedureFrontmatterSchema,
  ProcedureProvenanceSchema,
  ProcedureScopeSchema,
  createCanonicalProcedure,
  parseCanonicalProcedure,
  safeParseCanonicalProcedure,
  type AmpCompatibility,
  type CanonicalProcedure,
  type HarnessCompatibility,
  type HarnessOverlays,
  type InjectionPath,
  type ProcedureConflict,
  type ProcedureCurationMode,
  type ProcedureFrontmatter,
  type ProcedureParseResult,
  type ProcedureProvenance,
  type ProcedureScope,
} from "./schema.js";
