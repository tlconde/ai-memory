import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseRoleDeclaration,
  roleIncludesSubstrate,
  roleIncludesSurface,
} from "./role-declaration.js";

describe("parseRoleDeclaration", () => {
  it("accepts surface role", () => {
    const result = parseRoleDeclaration({ role: "surface" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.declaration.role, "surface");
    }
  });

  it("accepts substrate and both roles", () => {
    assert.equal(parseRoleDeclaration({ role: "substrate" }).success, true);
    assert.equal(parseRoleDeclaration({ role: "both" }).success, true);
  });

  it("rejects unknown role values", () => {
    const result = parseRoleDeclaration({ role: "hybrid" });
    assert.equal(result.success, false);
  });

  it("rejects extra keys", () => {
    const result = parseRoleDeclaration({ role: "surface", extra: true });
    assert.equal(result.success, false);
  });
});

describe("roleIncludesSurface / roleIncludesSubstrate", () => {
  it("surface role includes surface only", () => {
    assert.equal(roleIncludesSurface("surface"), true);
    assert.equal(roleIncludesSubstrate("surface"), false);
  });

  it("substrate role includes substrate only", () => {
    assert.equal(roleIncludesSurface("substrate"), false);
    assert.equal(roleIncludesSubstrate("substrate"), true);
  });

  it("both role includes surface and substrate", () => {
    assert.equal(roleIncludesSurface("both"), true);
    assert.equal(roleIncludesSubstrate("both"), true);
  });
});
