#!/usr/bin/env bash
# Clone upstream LongMemEval into third_party/longmemeval at a pinned commit.
# Re-running updates the local clone to the pinned SHA (hard reset).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMMIT_FILE="$SCRIPT_DIR/SCORER_COMMIT.txt"
TARGET="$ROOT/third_party/longmemeval"
UPSTREAM="https://github.com/xiaowu0162/LongMemEval.git"

if [[ ! -f "$COMMIT_FILE" ]]; then
  echo "fetch-scorer: missing $COMMIT_FILE" >&2
  exit 1
fi
PIN="$(tr -d '[:space:]' < "$COMMIT_FILE")"
if [[ -z "$PIN" ]]; then
  echo "fetch-scorer: SCORER_COMMIT.txt is empty" >&2
  exit 1
fi

mkdir -p "$ROOT/third_party"

if [[ -d "$TARGET/.git" ]]; then
  echo "fetch-scorer: syncing existing clone at $TARGET to $PIN"
  git -C "$TARGET" fetch --tags origin
  git -C "$TARGET" reset --hard "$PIN"
else
  echo "fetch-scorer: cloning $UPSTREAM -> $TARGET"
  git clone "$UPSTREAM" "$TARGET"
  git -C "$TARGET" checkout "$PIN"
fi

echo "fetch-scorer: pinned at $(git -C "$TARGET" rev-parse HEAD)"
