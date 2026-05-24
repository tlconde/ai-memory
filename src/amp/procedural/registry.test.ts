import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCanonicalProcedure } from "./schema.js";
import {
  ProcedureRegistry,
  ProcedureRegistryError,
} from "./registry.js";

describe("ProcedureRegistry", () => {
  it("registers, gets, lists, updates, and removes procedures", () => {
    const registry = new ProcedureRegistry();
    const alpha = createCanonicalProcedure({ name: "alpha", version: "1.0.0" });
    const beta = createCanonicalProcedure({ name: "beta", version: "0.2.0" });

    const registered = registry.register(alpha);
    assert.equal(registered.version, "1.0.0");
    assert.equal(registered.procedure.frontmatter.name, "alpha");

    registry.register(beta);
    assert.equal(registry.list().length, 2);
    assert.deepEqual(
      registry.list().map((entry) => entry.procedure.frontmatter.name).sort(),
      ["alpha", "beta"]
    );

    const fetched = registry.get("alpha");
    assert.ok(fetched);
    assert.equal(fetched.procedure.frontmatter.name, "alpha");

    const updated = registry.update(
      "alpha",
      createCanonicalProcedure({ name: "alpha", version: "1.1.0", body: "# Updated\n" })
    );
    assert.equal(updated.version, "1.1.0");
    assert.equal(registry.get("alpha")?.version, "1.1.0");
    assert.match(registry.get("alpha")?.procedure.body ?? "", /Updated/);

    assert.equal(registry.remove("beta"), true);
    assert.equal(registry.get("beta"), undefined);
    assert.equal(registry.remove("beta"), false);
    assert.equal(registry.list().length, 1);
  });

  it("detects name conflicts on register", () => {
    const registry = new ProcedureRegistry();
    registry.register(createCanonicalProcedure({ name: "capture-preference" }));

    assert.throws(
      () => registry.register(createCanonicalProcedure({ name: "capture-preference" })),
      (error: unknown) => {
        assert.ok(error instanceof ProcedureRegistryError);
        assert.match((error as Error).message, /already registered/);
        return true;
      }
    );
  });

  it("tracks conflicts_with and conflicts metadata from frontmatter", () => {
    const registry = new ProcedureRegistry();
    const entry = registry.register(
      createCanonicalProcedure({
        name: "new-capture",
        conflicts_with: ["legacy-capture"],
        conflicts: [
          {
            with: "legacy-capture",
            reason: "Overlapping trigger phrases",
            detected_at: "2026-05-25T12:00:00.000Z",
          },
        ],
      })
    );

    assert.deepEqual(entry.conflictsWith, ["legacy-capture"]);
    assert.equal(entry.conflicts[0]?.with, "legacy-capture");
    assert.equal(entry.conflicts[0]?.reason, "Overlapping trigger phrases");
    assert.equal(registry.get("new-capture")?.conflicts[0]?.detected_at, "2026-05-25T12:00:00.000Z");
  });

  it("updates conflict metadata and version on update", () => {
    const registry = new ProcedureRegistry();
    registry.register(createCanonicalProcedure({ name: "doctor", version: "0.1.0" }));

    const updated = registry.update(
      "doctor",
      createCanonicalProcedure({
        name: "doctor",
        version: "0.2.0",
        conflicts_with: ["legacy-doctor"],
        conflicts: [{ with: "legacy-doctor", reason: "Duplicate triggers" }],
      })
    );

    assert.equal(updated.version, "0.2.0");
    assert.deepEqual(updated.conflictsWith, ["legacy-doctor"]);
    assert.equal(updated.conflicts[0]?.with, "legacy-doctor");
  });

  it("records and preserves lastSyncedAt per harness target", () => {
    const registry = new ProcedureRegistry();
    registry.register(createCanonicalProcedure({ name: "sync-test" }));

    registry.setLastSyncedAt("sync-test", "cursor", "2026-05-25T10:00:00.000Z");
    registry.setLastSyncedAt("sync-test", "claude-code", "2026-05-25T11:00:00.000Z");

    const synced = registry.get("sync-test");
    assert.deepEqual(synced?.lastSyncedAt, {
      cursor: "2026-05-25T10:00:00.000Z",
      "claude-code": "2026-05-25T11:00:00.000Z",
    });

    registry.update("sync-test", createCanonicalProcedure({ name: "sync-test", version: "2.0.0" }));
    assert.deepEqual(registry.get("sync-test")?.lastSyncedAt, {
      cursor: "2026-05-25T10:00:00.000Z",
      "claude-code": "2026-05-25T11:00:00.000Z",
    });

    registry.setLastSyncedAt("sync-test", "cursor", "2026-05-25T12:00:00.000Z");
    assert.equal(registry.get("sync-test")?.lastSyncedAt.cursor, "2026-05-25T12:00:00.000Z");
  });

  it("rejects update and lastSyncedAt for missing procedures", () => {
    const registry = new ProcedureRegistry();

    assert.throws(
      () => registry.update("missing", createCanonicalProcedure({ name: "missing" })),
      ProcedureRegistryError
    );
    assert.throws(
      () => registry.setLastSyncedAt("missing", "cursor", "2026-05-25T00:00:00.000Z"),
      ProcedureRegistryError
    );
  });

  it("rejects update when procedure name does not match registry key", () => {
    const registry = new ProcedureRegistry();
    registry.register(createCanonicalProcedure({ name: "stable-name" }));

    assert.throws(
      () =>
        registry.update(
          "stable-name",
          createCanonicalProcedure({ name: "different-name" })
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProcedureRegistryError);
        assert.match((error as Error).message, /name mismatch/);
        return true;
      }
    );
  });
});
