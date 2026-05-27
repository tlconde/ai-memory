import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRuntimeCliEntityFilter } from "./runtime-cli-entity-filter.js";

describe("parseRuntimeCliEntityFilter", () => {
  it("accepts omitted entity filter", () => {
    assert.deepEqual(parseRuntimeCliEntityFilter(undefined), { ok: true });
  });

  it("accepts valid entity kinds", () => {
    const result = parseRuntimeCliEntityFilter("runtime-preference-candidate");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.entity, "runtime-preference-candidate");
      assert.equal(result.entitySchemaName, "RuntimePreferenceCandidate");
    }
  });

  it("rejects unknown entity kinds with inspect-compatible wording", () => {
    const result = parseRuntimeCliEntityFilter("not-a-real-kind");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Invalid runtime entity kind "not-a-real-kind"/);
      assert.match(result.error, /runtime-preference-candidate/);
    }
  });
});
