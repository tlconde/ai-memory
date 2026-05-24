import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AMP_USER_CONFIG_PATH_ENV, PROJECT_CONFIG_REL } from "../config/paths.js";
import {
  formatAmpDoctorReport,
  resolveAmpRepoRoot,
  runAmpDoctor,
} from "./doctor.js";
import { runAmpInit } from "./init.js";

const REPO_ROOT = resolveAmpRepoRoot(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
);

describe("runAmpDoctor", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-doctor-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("reports warnings for an uninitialized temp project but passes without errors", () => {
    const projectRoot = join(tempRoot, "uninitialized");
    const result = runAmpDoctor({ projectRoot, ampRepoRoot: REPO_ROOT });

    assert.equal(result.ok, true);
    assert.ok(
      result.findings.some(
        (f) => f.category === "project-config" && f.level === "warning"
      )
    );
    assert.ok(result.findings.some((f) => f.category === "ssa-spec" && f.level === "ok"));
    assert.ok(result.findings.some((f) => f.category === "sas-spec" && f.level === "ok"));
  });

  it("reports ok for project config and runtime after init", async () => {
    const projectRoot = join(tempRoot, "initialized");
    await runAmpInit({ projectRoot });

    const result = runAmpDoctor({ projectRoot, ampRepoRoot: REPO_ROOT });

    assert.equal(result.ok, true);
    assert.ok(
      result.findings.some(
        (f) => f.category === "project-config" && f.level === "ok"
      )
    );
    assert.ok(
      result.findings.some((f) => f.category === "runtime" && f.level === "ok")
    );
    assert.ok(
      result.findings.some(
        (f) => f.category === "config-discovery" && f.message.includes("project")
      )
    );
  });

  it("lists SSA unsupported capabilities as warnings", () => {
    const projectRoot = join(tempRoot, "cap-gaps");
    const result = runAmpDoctor({ projectRoot, ampRepoRoot: REPO_ROOT });

    const gap = result.findings.find((f) => f.category === "capability-gaps");
    assert.ok(gap);
    assert.equal(gap.level, "warning");
    assert.match(gap.message, /graph_traversal/);
    assert.match(gap.message, /procedural_registry/);
  });

  it("reports Hermes external_dirs auto-discovery as PROVISIONAL warning", () => {
    const projectRoot = join(tempRoot, "hermes-claims");
    const result = runAmpDoctor({ projectRoot, ampRepoRoot: REPO_ROOT });

    const provisional = result.findings.filter(
      (f) => f.category === "sas-external-claims" && f.level === "warning"
    );
    assert.ok(provisional.length >= 1);
    assert.ok(
      provisional.some((f) =>
        f.message.includes("skills/from-amp/ without external_dirs")
      )
    );
  });

  it("errors on invalid project config", async () => {
    const projectRoot = join(tempRoot, "invalid-config");
    const configPath = join(projectRoot, PROJECT_CONFIG_REL);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "not: [valid: yaml\n", "utf8");

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
      env: {
        ...process.env,
        [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user.yaml"),
      },
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.level === "error"));
  });

  it("formatAmpDoctorReport renders human-readable lines", () => {
    const projectRoot = join(tempRoot, "format");
    const result = runAmpDoctor({ projectRoot, ampRepoRoot: REPO_ROOT });
    const lines = formatAmpDoctorReport(result);

    assert.match(lines[0], /AMP doctor/);
    assert.ok(lines.some((line) => line.includes("[project-config]")));
    assert.ok(lines.some((line) => /Doctor finished|blocking errors/.test(line)));
  });
});
