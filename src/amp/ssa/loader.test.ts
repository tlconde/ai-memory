import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { AmpError, AmpErrorCode } from "../core/errors.js";
import { loadSsaSpecFromFile, loadSsaSpecFromYaml, tryLoadSsaSpecFromFile } from "./loader.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RAW_FS_SPEC = join(REPO_ROOT, "ssa-files/raw-fs.yaml");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

describe("loadSsaSpecFromYaml", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-ssa-loader-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("loads canonical raw-fs.yaml from the repo", () => {
    const spec = loadSsaSpecFromFile(RAW_FS_SPEC);
    assert.equal(spec.id, "raw-fs");
    assert.equal(spec.role, "substrate");
    assert.equal(spec.capability_coverage.curation_mode, "native");
    assert.equal(spec.capability_coverage.vector_search, "unsupported");
  });

  it("loads canonical gbrain.yaml from the repo", () => {
    const spec = loadSsaSpecFromFile(GBRAIN_SPEC);
    assert.equal(spec.id, "gbrain");
    assert.equal(spec.role, "substrate");
    assert.equal(spec.capability_coverage.frame_kinds.episodic, "native");
    assert.equal(spec.capability_coverage.frame_kinds.semantic, "native");
    assert.equal(spec.capability_coverage.frame_kinds.crystal, "wrapped");
    assert.equal(spec.capability_coverage.vector_search, "wrapped");
    assert.equal(spec.capability_coverage.graph_traversal, "wrapped");
    assert.equal(spec.capability_coverage.transactions, "unsupported");
    assert.equal(spec.capability_coverage.embedding_storage, "wrapped");
    assert.equal(spec.capability_coverage.full_text_search, "wrapped");
    assert.equal(spec.capability_coverage.profile_slots, "unsupported");
    assert.equal(spec.capability_coverage.procedural_registry, "unsupported");
    assert.equal(
      spec.external_claims?.find((c) => c.claim.includes("gbrain serve"))?.label,
      "VERIFIED"
    );
  });

  it("loads valid SSA YAML from a temp path", async () => {
    const path = join(tempRoot, "test-ssa.yaml");
    await writeFile(
      path,
      `id: temp-ssa
name: Temp SSA
version: 0.0.1
role: substrate
capability_coverage:
  frame_kinds:
    episodic: native
    semantic: native
    crystal: wrapped
  curation_mode: native
  vector_search: unsupported
  graph_traversal: unsupported
  transactions: wrapped
  embedding_storage: unsupported
  full_text_search: unsupported
  profile_slots: unsupported
  procedural_registry: unsupported
  skill_optimization: unsupported
  action_log: unsupported
external_claims:
  - claim: Temp backend uses isolated paths in tests
    label: VERIFIED
`
    );

    const spec = loadSsaSpecFromFile(path);
    assert.equal(spec.id, "temp-ssa");
    assert.equal(spec.external_claims?.[0]?.label, "VERIFIED");
  });

  it("returns failure for invalid YAML syntax", async () => {
    const path = join(tempRoot, "broken.yaml");
    await writeFile(path, "id: [\n");
    const result = tryLoadSsaSpecFromFile(path);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /Invalid YAML/i);
  });

  it("throws frame schema mismatch for invalid SSA shape", async () => {
    const path = join(tempRoot, "wrong-role.yaml");
    await writeFile(
      path,
      `id: x
name: X
version: 0.1.0
role: surface
capability_coverage: {}
`
    );

    assert.throws(
      () => loadSsaSpecFromFile(path),
      (err: unknown) => {
        assert.ok(err instanceof AmpError);
        assert.equal(err.code, AmpErrorCode.FRAME_SCHEMA_MISMATCH);
        return true;
      }
    );
  });

  it("rejects empty YAML documents", () => {
    const result = loadSsaSpecFromYaml("");
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /empty/i);
  });
});
