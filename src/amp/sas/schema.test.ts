import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseSasSpec } from "./schema.js";

const VALID_SAS = {
  id: "test-sas",
  name: "Test SAS",
  version: "0.1.0",
  role: "surface" as const,
  injection_modes: ["filesystem-native"] as const,
  from_amp_path: ".cursor/rules/from-amp",
  emitted_artifact: {
    format: "mdc" as const,
    naming: "flat" as const,
  },
};

describe("parseSasSpec", () => {
  it("accepts a valid surface spec", () => {
    const result = parseSasSpec(VALID_SAS);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.spec.role, "surface");
    assert.deepEqual(result.spec.injection_modes, ["filesystem-native"]);
  });

  it("rejects non-surface role", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      role: "substrate",
    });
    assert.equal(result.success, false);
  });

  it("rejects empty injection_modes", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      injection_modes: [],
    });
    assert.equal(result.success, false);
  });

  it("rejects unknown injection mode values", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      injection_modes: ["magic-inject"],
    });
    assert.equal(result.success, false);
  });

  it("rejects unknown top-level keys", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      undocumented: true,
    });
    assert.equal(result.success, false);
  });

  it("accepts external_claims with PROVISIONAL label", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      external_claims: [
        {
          claim: "Harness loads from-amp rules on session start",
          label: "PROVISIONAL",
        },
      ],
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.spec.external_claims?.[0]?.label, "PROVISIONAL");
  });

  it("rejects invalid emitted_artifact format", () => {
    const result = parseSasSpec({
      ...VALID_SAS,
      emitted_artifact: { format: "html", naming: "flat" },
    });
    assert.equal(result.success, false);
  });
});
