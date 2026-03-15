#!/usr/bin/env bash
# Runs both hybrid search experiments (QMD + in-house) in Linux/WSL.
# On Windows, invoke via: wsl bash ./experiments/hybrid-search/run-all.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS="$SCRIPT_DIR/results"

cd "$REPO_ROOT"
echo "=== Hybrid Search Experiment ==="
echo "Repo root: $REPO_ROOT"
echo ""

# Approach A: QMD
echo "--- Approach A: QMD ---"
cd "$SCRIPT_DIR/sandbox-a-qmd"
if [ ! -d node_modules ]; then
  npm install
fi
node run-qmd-experiment.mjs
echo ""

# Approach B: In-house
echo "--- Approach B: In-house ---"
cd "$SCRIPT_DIR/sandbox-b-inhouse"
if [ ! -d node_modules ]; then
  npm install
fi
node run.js
echo ""

echo "=== Done. Results in $RESULTS ==="
ls -la "$RESULTS"/*.json
