/**
 * Maps AMP protocol invariants to falsifiable test IDs (Invariant 5).
 */

export const INVARIANT_IDS = {
  INV_1_SCOPE_NEVER_INFERRED: "INV-1",
  INV_2_INJECTABILITY_HONEST: "INV-2",
  INV_3_CLOUD_BOUNDED: "INV-3",
  INV_4_FROM_AMP_ISOLATED: "INV-4",
  INV_5_FALSIFIABLE_CLAIMS: "INV-5",
  INV_6_LOCAL_GITIGNORE: "INV-6",
} as const;

export type InvariantId = (typeof INVARIANT_IDS)[keyof typeof INVARIANT_IDS];

export interface InvariantTestMapping {
  invariantId: InvariantId;
  description: string;
  testFiles: string[];
}

export const INVARIANT_TEST_REGISTRY: InvariantTestMapping[] = [
  {
    invariantId: INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED,
    description: "Project scope cannot promote to user scope without explicit confirmation frame",
    testFiles: ["src/amp/core/scope-gate.test.ts"],
  },
  {
    invariantId: INVARIANT_IDS.INV_2_INJECTABILITY_HONEST,
    description: "Capability coverage reports unsupported features honestly",
    testFiles: [
      "src/amp/adapter-contract/capability-coverage.test.ts",
      "src/amp/conformance/gbrain-capability-honesty.test.ts",
    ],
  },
  {
    invariantId: INVARIANT_IDS.INV_3_CLOUD_BOUNDED,
    description: "Deferred in vertical slice — cloud surfaces out of scope",
    testFiles: [],
  },
  {
    invariantId: INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED,
    description: "Harness adapters reject writes outside from-amp roots",
    testFiles: [
      "src/amp/path-safety/guard.test.ts",
      "src/amp/adapters/sas/cursor/adapter.test.ts",
      "src/amp/adapters/sas/claude-code/adapter.test.ts",
    ],
  },
  {
    invariantId: INVARIANT_IDS.INV_5_FALSIFIABLE_CLAIMS,
    description: "Core wire protocol and E2E slice claims have automated tests",
    testFiles: [
      "src/amp/core/frame-schema.test.ts",
      "src/amp/integration/preference-vertical-slice.test.ts",
      "src/amp/integration/optimizer-vertical-slice.test.ts",
    ],
  },
  {
    invariantId: INVARIANT_IDS.INV_6_LOCAL_GITIGNORE,
    description: "AMP-managed project-local artifacts are git-ignored and not trackable",
    testFiles: [
      "src/amp/gitignore/ensure.test.ts",
      "src/amp/gitignore/check.test.ts",
      "src/amp/cli/init.test.ts",
      "src/amp/cli/doctor.test.ts",
      "src/amp/integration/invariant-6-git-status.test.ts",
    ],
  },
];

export function listInvariantCoverage(): InvariantTestMapping[] {
  return structuredClone(INVARIANT_TEST_REGISTRY);
}

export function invariantIdsForTestFile(testFile: string): InvariantId[] {
  return INVARIANT_TEST_REGISTRY.filter((entry) => entry.testFiles.includes(testFile)).map(
    (entry) => entry.invariantId
  );
}
