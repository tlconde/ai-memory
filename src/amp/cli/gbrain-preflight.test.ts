import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";

import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  AMP_LIVE_GBRAIN_TEST_ENV,
} from "../gbrain/live-policy.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import {
  formatAmpGbrainPreflightReport,
  runAmpGbrainPreflight,
} from "./gbrain-preflight.js";

function fakeSpawn(
  scenarios: Record<string, SpawnSyncReturns<string>>
): typeof import("node:child_process").spawnSync {
  return ((command: string, args: readonly string[]) => {
    const key = `${command} ${args.join(" ")}`;
    if (scenarios[key]) {
      return scenarios[key];
    }
    if (command === "which" || command === "where") {
      return { status: 1, stdout: "", stderr: "" } as SpawnSyncReturns<string>;
    }
    return { status: 1, stdout: "", stderr: "unknown command" } as SpawnSyncReturns<string>;
  }) as typeof import("node:child_process").spawnSync;
}

describe("runAmpGbrainPreflight", () => {
  it("reports offline-safe backend without live write confirmation", () => {
    const spawnFn = fakeSpawn({
      "which gbrain": { status: 0, stdout: "/usr/bin/gbrain\n", stderr: "" },
      "gbrain --version": { status: 0, stdout: "gbrain 0.40.2.0\n", stderr: "" },
      "gbrain serve --help": { status: 0, stdout: "Usage: gbrain serve\n", stderr: "" },
      "gbrain doctor --json": {
        status: 0,
        stdout: '{"status":"ok"}',
        stderr: "",
      },
    });

    const result = runAmpGbrainPreflight({
      knowledge: "in-memory",
      env: {},
      spawnFn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.resolvedBackend, "in-memory");
    assert.ok(
      result.findings.some((f) => f.category === "backend-mode" && /in-memory/.test(f.message))
    );
    assert.ok(
      result.findings.some(
        (f) => f.category === "live-test" && /disabled/.test(f.message)
      )
    );
  });

  it("warns when gbrain doctor recommends migrate-only without running it", () => {
    const spawnFn = fakeSpawn({
      "which gbrain": { status: 0, stdout: "/usr/bin/gbrain\n", stderr: "" },
      "gbrain --version": { status: 0, stdout: "gbrain 0.40.2.0\n", stderr: "" },
      "gbrain serve --help": { status: 0, stdout: "Usage: gbrain serve\n", stderr: "" },
      "gbrain doctor --json": {
        status: 1,
        stdout: "",
        stderr: "Schema probe/migrate failed\nTry: gbrain init --migrate-only\n",
      },
    });

    const result = runAmpGbrainPreflight({
      knowledge: "gbrain",
      env: {},
      spawnFn,
    });

    assert.equal(result.ok, true);
    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "gbrain-migrate" &&
          /migrate-only/.test(f.message) &&
          /will NOT run migrations/.test(f.message)
      )
    );
  });

  it("reports live test enabled and write confirmation env", () => {
    const spawnFn = fakeSpawn({
      "which gbrain": { status: 1, stdout: "", stderr: "" },
    });

    const result = runAmpGbrainPreflight({
      knowledge: "gbrain",
      env: {
        [AMP_LIVE_GBRAIN_TEST_ENV]: "1",
        [AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV]: "1",
        [AMP_KNOWLEDGE_BACKEND_ENV]: "gbrain",
      },
      spawnFn,
    });

    assert.ok(
      result.findings.some((f) => f.category === "live-test" && /may mutate/.test(f.message))
    );
    assert.ok(
      result.findings.some((f) => f.category === "live-mutation" && /confirmation is ON/.test(f.message))
    );
  });

  it("documents live reads separately from write confirmation", () => {
    const spawnFn = fakeSpawn({ "which gbrain": { status: 1, stdout: "", stderr: "" } });
    const result = runAmpGbrainPreflight({ knowledge: "gbrain", env: {}, spawnFn });
    assert.ok(result.findings.some((f) => f.category === "live-read" && /retrieve/.test(f.message)));
    assert.ok(
      result.findings.some(
        (f) => f.category === "operator-summary" && /Live writes require confirmation/.test(f.message)
      )
    );
  });

  it("fails closed on invalid backend", () => {
    const result = runAmpGbrainPreflight({
      knowledge: "postgres",
      env: {},
      spawnFn: fakeSpawn({}),
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.level === "error"));
  });

  it("formatAmpGbrainPreflightReport includes summary footer", () => {
    const lines = formatAmpGbrainPreflightReport({
      projectRoot: "/tmp/project",
      resolvedBackend: "fake-gbrain",
      findings: [
        { level: "ok", category: "backend-mode", message: "offline-safe" },
      ],
      ok: true,
    });

    assert.match(lines.join("\n"), /AMP gbrain preflight/);
    assert.match(lines.join("\n"), /Preflight complete/);
  });
});
