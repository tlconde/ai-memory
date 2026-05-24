import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAmpConfigFile, safeParseAmpConfigFile } from "./schema.js";

describe("AmpConfigFileSchema", () => {
  it("accepts project and runtime settings", () => {
    const parsed = parseAmpConfigFile({
      amp_config_version: "1.0",
      project_ref: "ai-memory",
      runtime: { db_path: "/tmp/custom/runtime.db" },
    });

    assert.equal(parsed.project_ref, "ai-memory");
    assert.equal(parsed.runtime?.db_path, "/tmp/custom/runtime.db");
  });

  it("rejects unknown top-level keys", () => {
    const parsed = safeParseAmpConfigFile({
      project_ref: "ai-memory",
      unexpected: true,
    });
    assert.equal(parsed.success, false);
  });
});
