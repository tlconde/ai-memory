/**
 * Dataset loader: reads a LongMemEval JSON file from `LME_DATA_DIR`, verifies
 * the SHA256 against a pinned value, returns the parsed question array.
 */
import { createHash } from "crypto";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import type { DatasetName, LMEQuestion } from "./types.js";

/** Pinned SHA256 per dataset file. Recorded 2026-04-20. */
export const DATASET_HASHES: Record<DatasetName, string> = {
  oracle: "821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c",
  s: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
};

export const DATASET_FILES: Record<DatasetName, string> = {
  oracle: "longmemeval_oracle.json",
  s: "longmemeval_s_cleaned.json",
};

export interface LoadedDataset {
  name: DatasetName;
  file: string;
  path: string;
  sha256: string;
  questions: LMEQuestion[];
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface LoadDatasetOptions {
  /** Override the pinned hash — used by tests with synthetic fixtures. */
  expectedSha256?: string;
  /** Override the dataset dir — used by tests. */
  dataDir?: string;
  /** Override the filename — used by tests. */
  file?: string;
}

/**
 * Load and verify a LongMemEval dataset file. Aborts with a clear error on
 * hash mismatch (wrong file, partial download, or upstream update).
 */
export async function loadDataset(
  name: DatasetName,
  options: LoadDatasetOptions = {}
): Promise<LoadedDataset> {
  const dir = options.dataDir ?? process.env.LME_DATA_DIR;
  if (!dir || dir.length === 0) {
    throw new Error(
      `LME_DATA_DIR is required (e.g. "/Volumes/SSD EXT/ai-memory-bench-data/longmemeval"). Set it in .env.local or the shell.`
    );
  }
  const file = options.file ?? DATASET_FILES[name];
  const path = join(dir, file);

  try {
    await stat(path);
  } catch {
    throw new Error(
      `Dataset file not found: ${path}. Ensure LME_DATA_DIR points at the external SSD and the file has been downloaded.`
    );
  }

  const buf = await readFile(path);
  const sha = sha256Hex(buf);
  const expected = options.expectedSha256 ?? DATASET_HASHES[name];
  if (sha !== expected) {
    throw new Error(
      `SHA256 mismatch for ${path}\n  expected: ${expected}\n  actual:   ${sha}\nAborting. If the upstream dataset was intentionally updated, update benchmarks/longmemeval/src/dataset.ts.`
    );
  }

  const parsed = JSON.parse(buf.toString("utf-8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Dataset ${path} did not parse to an array (found ${typeof parsed}).`);
  }
  return { name, file, path, sha256: sha, questions: parsed as LMEQuestion[] };
}
