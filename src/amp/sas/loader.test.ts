import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { AmpError, AmpErrorCode } from "../core/errors.js";
import { loadSasSpecFromFile, tryLoadSasSpecFromFile } from "./loader.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CURSOR_SPEC = join(REPO_ROOT, "sas-files/cursor.yaml");
const CLAUDE_CODE_SPEC = join(REPO_ROOT, "sas-files/claude-code.yaml");

describe("loadSasSpecFromFile", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-sas-loader-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("loads canonical cursor.yaml from the repo", () => {
    const spec = loadSasSpecFromFile(CURSOR_SPEC);
    assert.equal(spec.id, "cursor");
    assert.equal(spec.role, "surface");
    assert.deepEqual(spec.injection_modes, ["filesystem-native"]);
    assert.equal(spec.from_amp_path, ".cursor/rules/from-amp");
    assert.equal(spec.emitted_artifact.format, "mdc");
    assert.equal(spec.emitted_artifact.naming, "flat");
  });

  it("loads canonical claude-code.yaml from the repo", () => {
    const spec = loadSasSpecFromFile(CLAUDE_CODE_SPEC);
    assert.equal(spec.id, "claude-code");
    assert.equal(spec.emitted_artifact.format, "skill-md");
    assert.equal(spec.emitted_artifact.naming, "folder-per-skill");
    assert.equal(spec.from_amp_path, "from-amp");
  });

  it("loads valid SAS YAML from a temp path", async () => {
    const path = join(tempRoot, "temp-sas.yaml");
    await writeFile(
      path,
      `id: temp-sas
name: Temp SAS
version: 0.0.1
role: surface
injection_modes:
  - filesystem-native
from_amp_path: from-amp
emitted_artifact:
  format: skill-md
  naming: folder-per-skill
external_claims:
  - claim: Placement verified only in unit tests
    label: UNKNOWN
`
    );

    const spec = loadSasSpecFromFile(path);
    assert.equal(spec.id, "temp-sas");
    assert.equal(spec.external_claims?.[0]?.label, "UNKNOWN");
  });

  it("returns failure when file is missing", () => {
    const result = tryLoadSasSpecFromFile(join(tempRoot, "missing.yaml"));
    assert.equal(result.success, false);
  });

  it("throws frame schema mismatch for invalid SAS shape", async () => {
    const path = join(tempRoot, "bad-sas.yaml");
    await writeFile(
      path,
      `id: bad
name: Bad
version: 0.1.0
role: surface
injection_modes: []
from_amp_path: from-amp
emitted_artifact:
  format: mdc
  naming: flat
`
    );

    assert.throws(
      () => loadSasSpecFromFile(path),
      (err: unknown) => {
        assert.ok(err instanceof AmpError);
        assert.equal(err.code, AmpErrorCode.FRAME_SCHEMA_MISMATCH);
        return true;
      }
    );
  });
});
