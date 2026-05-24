#!/usr/bin/env bash
# Invoke upstream LongMemEval evaluate_qa.py via `uv run`.
#
# Usage: run-evaluate-qa.sh <judge-model> <hypotheses.jsonl> <references.json>
#
# Reads OPENAI_API_KEY from the environment (caller is expected to have
# loaded .env.local already — cli.ts does this via src/env.ts).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVAL_PY="$ROOT/third_party/longmemeval/src/evaluation/evaluate_qa.py"

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 <judge-model> <hyp.jsonl> <ref.json>" >&2
  exit 2
fi

MODEL="$1"
HYP="$2"
REF="$3"

if [[ ! -f "$EVAL_PY" ]]; then
  echo "run-evaluate-qa: upstream scorer not found at $EVAL_PY" >&2
  echo "run: benchmarks/longmemeval/scripts/fetch-scorer.sh" >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "run-evaluate-qa: OPENAI_API_KEY is not set" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "run-evaluate-qa: \`uv\` not found on PATH. Install from https://docs.astral.sh/uv/" >&2
  exit 1
fi

exec uv run --python 3.12 --with openai --with tqdm --with backoff --with numpy \
  python "$EVAL_PY" "$MODEL" "$HYP" "$REF"
