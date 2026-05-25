#!/usr/bin/env node
/**
 * Copy bundled AMP SSA/SAS YAML specs into dist for installed-package runtime.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST_ROOT = join(REPO_ROOT, "dist");
const SPEC_DIRS = ["ssa-files", "sas-files"];

if (!existsSync(DIST_ROOT)) {
  console.error(`copy-amp-specs: dist not found at ${DIST_ROOT} — run tsc first.`);
  process.exit(1);
}

for (const dir of SPEC_DIRS) {
  const sourceDir = join(REPO_ROOT, dir);
  if (!existsSync(sourceDir)) {
    console.error(`copy-amp-specs: missing source directory ${sourceDir}`);
    process.exit(1);
  }

  const destDir = join(DIST_ROOT, dir);
  mkdirSync(destDir, { recursive: true });

  const yamlFiles = readdirSync(sourceDir).filter((name) => name.endsWith(".yaml"));
  if (yamlFiles.length === 0) {
    console.error(`copy-amp-specs: no .yaml files in ${sourceDir}`);
    process.exit(1);
  }

  for (const name of yamlFiles) {
    cpSync(join(sourceDir, name), join(destDir, name));
  }

  console.log(`copy-amp-specs: copied ${yamlFiles.length} file(s) to ${destDir}`);
}
