/**
 * SAS spec YAML loader.
 *
 * Falsifiable claim: loading a valid SAS YAML file returns a parsed surface spec
 * with injection_modes and emitted_artifact preserved.
 */

import { readFileSync } from "node:fs";

import yaml from "js-yaml";

import { frameSchemaMismatch } from "../core/errors.js";
import { parseSasSpec, type SasSpec, type SasSpecParseResult } from "./schema.js";

export function loadSasSpecFromYaml(content: string): SasSpecParseResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: `Invalid YAML: ${message}` };
  }

  if (parsed === null || parsed === undefined) {
    return { success: false, error: "SAS spec YAML is empty" };
  }

  return parseSasSpec(parsed);
}

/** Load and validate a SAS spec from a filesystem path. */
export function loadSasSpecFromFile(filePath: string): SasSpec {
  const content = readFileSync(filePath, "utf8");
  const result = loadSasSpecFromYaml(content);
  if (!result.success) {
    throw frameSchemaMismatch({ path: filePath, error: result.error, issues: result.issues });
  }
  return result.spec;
}

/** Load SAS spec without throwing; for callers that prefer result objects. */
export function tryLoadSasSpecFromFile(filePath: string): SasSpecParseResult {
  try {
    const content = readFileSync(filePath, "utf8");
    return loadSasSpecFromYaml(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: message };
  }
}
