export {
  RUNTIME_STATUS_LOCAL_STORAGE_NOTE,
} from "./messages.js";

export {
  formatEpisodicFrameForRuntime,
  formatHarnessOperationalStateForRuntime,
  formatRejectedSignalLogForRuntime,
  formatRuntimeCrystalCandidateForRuntime,
  formatRuntimePreferenceCandidateForRuntime,
  formatUnresolvedDecisionForRuntime,
  joinRuntimeProjectionLines,
} from "./format-projection.js";

export {
  FORMATTER_REGISTRY_KINDS,
  formatParsedRuntimeEntityForProjection,
  formatRuntimeEntityForProjection,
  getFormatterRegistryEntry,
  isFormatterRegistryKind,
  isProjectableFormatterKind,
  parseRuntimeEntityAtBoundary,
  PROJECTABLE_FORMATTER_KINDS,
  resolveFormatterRegistryEntry,
  RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY,
  RUNTIME_FORMATTER_REGISTRY,
} from "./formatter-registry.js";

export {
  InMemoryRuntimeSemanticEntitySource,
  materializeRuntimeProjectionFromSource,
  resolveRuntimeSemanticEntitySection,
} from "./projection-source.js";

export { validateRuntimeSemanticEntityForStorage } from "./storage-validation.js";
export { validateRuntimeSemanticEntityWriteProvenance } from "./provenance-validation.js";

export {
  parseRuntimeSemanticEntityRecordFromUnknown,
  runtimeSemanticEntityRecordIdFromUnknown,
  safeParseRuntimeSemanticEntityRecordFromUnknown,
} from "./entity-record-parse.js";

export {
  RuntimeSemanticStorageEntitySource,
  RuntimeStoreSemanticEntityReader,
} from "./storage-source.js";

export {
  RuntimeStoreSemanticEntityWriter,
  writeRuntimeSemanticEntity,
} from "./storage-writer.js";

export {
  createRuntimeSemanticCaptureFacade,
  type CaptureRejectedRuntimeSignalFailureReason,
  type CaptureRejectedRuntimeSignalResult,
  type CaptureRuntimeCorrectionFailureReason,
  type CaptureRuntimeCorrectionResult,
  type ExplicitRuntimeCorrectionCaptureInput,
  type FilteredRuntimeCaptureInput,
  type FilteredRuntimeCaptureResult,
  type RuntimeRejectedCaptureInput,
  type RuntimeSemanticCaptureFacade,
  type RuntimeSemanticCaptureFacadeDeps,
  type RuntimeSemanticCaptureWriteResult,
} from "./capture-facade.js";

export {
  RUNTIME_CAPTURE_REDACTED_EXCERPT_MAX_CHARS,
  RUNTIME_CAPTURE_REJECTION_REASON_CODES,
  RUNTIME_CAPTURE_VERBATIM_MAX_CHARS,
  computeRuntimeCaptureSourceHash,
  evaluateRuntimeCaptureExclusionFilter,
  redactRuntimeCaptureExcerpt,
  type RuntimeCaptureAcceptedSignal,
  type RuntimeCaptureExclusionFilterResult,
  type RuntimeCaptureExclusionHint,
  type RuntimeCaptureRejectionAudit,
  type RuntimeCaptureRejectionReasonCode,
  type RuntimeCaptureSignalInput,
} from "./capture-exclusion-filter.js";

export {
  REJECTED_SIGNAL_DEFAULT_RECORD_ID_PREFIX,
  defaultRejectedSignalRecordId,
  mapRejectedRuntimeCaptureToEntityRecord,
} from "./capture-rejected-signal-mapper.js";

export type {
  FormatterEntityByKind,
  FormatterOptionsByKind,
  FormatterPolicy,
  FormatterRegistryKind,
  FormatterRegistrySchemaName,
  FormatterSubEntityMetadata,
  FormatRuntimeEntityForProjectionResult,
  FormatRuntimeEntityProjectionFailureReason,
  ProjectionEligibility,
  ProjectableFormatterKind,
  RuntimeFormatterRegistryEntry,
  SensitivityPolicy,
} from "./formatter-registry.js";

export type {
  RuntimeFormatterRegistryKind,
  RuntimeSemanticEntityRecord,
  RuntimeSemanticEntitySource,
} from "./entity-record.js";

export type {
  MaterializeRuntimeProjectionFromSourceOptions,
  MaterializeRuntimeProjectionFromSourceResult,
  RuntimeProjectionMaterializationSkip,
  RuntimeProjectionMaterializationSkipReason,
  RuntimeProjectionMaterializedItem,
  RuntimeProjectionTargetSection,
} from "./projection-source.js";

export type { RuntimeSemanticEntityReader } from "./storage-source.js";

export type {
  RuntimeSemanticEntityWriteFailureReason,
  RuntimeSemanticEntityWriteResult,
} from "./storage-validation.js";

export type {
  RuntimeSemanticEntityProvenanceFailureReason,
  RuntimeSemanticEntityProvenanceValidationResult,
} from "./provenance-validation.js";

export type {
  RuntimeSemanticEntityRecordParseFailureReason,
  RuntimeSemanticEntityRecordParseResult,
} from "./entity-record-parse.js";

export type {
  FormatEpisodicFrameOptions,
  FormatHarnessOperationalOptions,
  FormatRuntimePreferenceOptions,
  FormatUnresolvedDecisionOptions,
  RuntimeProjectionFormat,
} from "./format-projection.js";

export {
  ContradictionScoreSchema,
  CurrentDecisionLeaningSchema,
  CurationModeSchema,
  DecisionFreshnessSchema,
  DecisionOptionSchema,
  DormantSnapshotActivationHistorySchema,
  DormantSnapshotEncodingContextSchema,
  DormantSnapshotGeneratedBySchema,
  DormantSnapshotRelatedEntitiesSchema,
  DormantSnapshotSchema,
  EpisodicAccessStatsSchema,
  EpisodicEventTypeSchema,
  EpisodicFrameSchema,
  EpisodicLifecycleStateSchema,
  EpisodicProvenanceSchema,
  EpisodicRelatedEntitiesSchema,
  EpisodicSensitivitySchema,
  EpisodicVisibilitySchema,
  HarnessOperationalStateSchema,
  RejectedSignalLogSchema,
  RUNTIME_ENTITY_KINDS,
  RUNTIME_ENTITY_REGISTRY,
  RUNTIME_ENTITY_SCHEMA_NAMES,
  RuntimeConfidenceSchema,
  RuntimeCrystalCandidateSchema,
  RuntimeCrystalLineageSchema,
  RuntimePreferenceCandidateSchema,
  RuntimePreferenceContextSchema,
  RuntimePreferenceModeSchema,
  RuntimePreferencePromotionEvidenceSchema,
  RuntimeSourceSchema,
  ScopeKindSchema,
  UnresolvedDecisionSchema,
  parseCurrentDecisionLeaning,
  parseDormantSnapshot,
  parseEpisodicFrame,
  parseHarnessOperationalState,
  parseRejectedSignalLog,
  parseRuntimeCrystalCandidate,
  parseRuntimePreferenceCandidate,
  isRuntimeEntityKind,
  parseUnresolvedDecision,
  runtimeEntitySchemaNameForKind,
  safeParseCurrentDecisionLeaning,
  safeParseDormantSnapshot,
  safeParseEpisodicFrame,
  safeParseHarnessOperationalState,
  safeParseRejectedSignalLog,
  safeParseRuntimeCrystalCandidate,
  safeParseRuntimePreferenceCandidate,
  safeParseUnresolvedDecision,
} from "./schema.js";

export type {
  ContradictionScore,
  CurrentDecisionLeaning,
  DecisionFreshness,
  DecisionOption,
  DormantSnapshot,
  DormantSnapshotActivationHistory,
  DormantSnapshotEncodingContext,
  DormantSnapshotGeneratedBy,
  DormantSnapshotRelatedEntities,
  EpisodicAccessStats,
  EpisodicEventType,
  EpisodicFrame,
  EpisodicLifecycleState,
  EpisodicProvenance,
  EpisodicRelatedEntities,
  EpisodicSensitivity,
  EpisodicVisibility,
  HarnessOperationalState,
  RejectedSignalLog,
  RuntimeEntityKind,
  RuntimeEntitySchemaName,
  RuntimeConfidence,
  RuntimeCrystalCandidate,
  RuntimeCrystalLineage,
  RuntimeEntityParseResult,
  RuntimePreferenceCandidate,
  RuntimePreferenceContext,
  RuntimePreferenceMode,
  RuntimePreferencePromotionEvidence,
  RuntimeSource,
  UnresolvedDecision,
} from "./schema.js";

export type { CurationMode, ScopeKind } from "../core/frame-schema.js";
