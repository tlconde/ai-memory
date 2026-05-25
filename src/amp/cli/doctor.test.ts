import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { AMP_USER_CONFIG_PATH_ENV, PROJECT_CONFIG_REL } from "../config/paths.js";
import {
  formatAmpDoctorReport,
  HERMES_CONFIG_PATH_ENV,
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

  it("uses projectRoot/home for Hermes when homedir is not injected", async () => {
    const projectRoot = join(tempRoot, "hermes-default-home");
    await mkdir(join(projectRoot, "skills", "from-amp"), { recursive: true });

    const defaultHome = join(projectRoot, "home");
    await mkdir(join(defaultHome, ".hermes"), { recursive: true });
    await writeFile(
      join(defaultHome, ".hermes", "config.yaml"),
      yaml.dump({ skills: { external_dirs: [join(projectRoot, "skills")] } }),
      "utf8"
    );

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
    });

    const expectedConfigPath = join(defaultHome, ".hermes", "config.yaml");
    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "hermes-discovery" &&
          f.message.includes(expectedConfigPath)
      )
    );
    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "hermes-discovery" &&
          f.level === "ok" &&
          f.message.includes("listed in Hermes skills.external_dirs")
      )
    );
  });

  it("warns when Hermes external_dirs omits project skills root", async () => {
    const projectRoot = join(tempRoot, "hermes-missing-ext");
    await mkdir(join(projectRoot, "skills", "from-amp"), { recursive: true });

    const fakeHome = join(tempRoot, "hermes-home-missing");
    await mkdir(join(fakeHome, ".hermes"), { recursive: true });
    await writeFile(
      join(fakeHome, ".hermes", "config.yaml"),
      yaml.dump({ skills: { external_dirs: ["/some/other/skills"] } }),
      "utf8"
    );

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
      homedir: () => fakeHome,
    });

    const warn = result.findings.find(
      (f) => f.category === "hermes-discovery" && f.level === "warning"
    );
    assert.ok(warn);
    assert.match(warn.message, /skills\/from-amp/);
    assert.match(warn.message, /external_dirs/);
  });

  it("reports ok when project skills root is listed in Hermes external_dirs", async () => {
    const projectRoot = join(tempRoot, "hermes-configured");
    await mkdir(join(projectRoot, "skills", "from-amp"), { recursive: true });

    const fakeHome = join(tempRoot, "hermes-home-ok");
    await mkdir(join(fakeHome, ".hermes"), { recursive: true });
    await writeFile(
      join(fakeHome, ".hermes", "config.yaml"),
      yaml.dump({ skills: { external_dirs: [join(projectRoot, "skills")] } }),
      "utf8"
    );

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
      homedir: () => fakeHome,
    });

    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "hermes-discovery" &&
          f.level === "ok" &&
          f.message.includes("listed in Hermes skills.external_dirs")
      )
    );
  });

  it("treats trailing slashes in external_dirs as equivalent to project skills root", async () => {
    const projectRoot = join(tempRoot, "hermes-trailing-slash");
    await mkdir(join(projectRoot, "skills", "from-amp"), { recursive: true });

    const fakeHome = join(tempRoot, "hermes-home-trailing");
    await mkdir(join(fakeHome, ".hermes"), { recursive: true });
    await writeFile(
      join(fakeHome, ".hermes", "config.yaml"),
      yaml.dump({
        skills: { external_dirs: [`${join(projectRoot, "skills")}/`] },
      }),
      "utf8"
    );

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
      homedir: () => fakeHome,
    });

    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "hermes-discovery" &&
          f.level === "ok" &&
          f.message.includes("listed in Hermes skills.external_dirs")
      )
    );
  });

  it("reads Hermes config via HERMES_CONFIG_PATH env override", async () => {
    const projectRoot = join(tempRoot, "hermes-env-config");
    await mkdir(join(projectRoot, "skills", "from-amp"), { recursive: true });

    const configPath = join(tempRoot, "hermes-config-env.yaml");
    await writeFile(
      configPath,
      yaml.dump({ skills: { external_dirs: [join(projectRoot, "skills")] } }),
      "utf8"
    );

    const result = runAmpDoctor({
      projectRoot,
      ampRepoRoot: REPO_ROOT,
      env: {
        ...process.env,
        [HERMES_CONFIG_PATH_ENV]: configPath,
      },
    });

    assert.ok(
      result.findings.some(
        (f) =>
          f.category === "hermes-discovery" &&
          f.level === "ok" &&
          f.message.includes("listed in Hermes skills.external_dirs")
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
