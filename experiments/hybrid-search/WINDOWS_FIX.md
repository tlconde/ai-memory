# Windows Compatibility Fix

Both QMD (sqlite-vec) and in-house (onnxruntime-node) hit Windows-specific blockers. **Solution: run in WSL.**

## Quick Fix

```powershell
# From repo root
node experiments/hybrid-search/run-all.js
```

This detects Windows and runs the experiments in WSL automatically. Requires [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) installed.

## Manual WSL Run

```powershell
wsl bash -c "cd /mnt/d/Dev/Github/ai-memory && ./experiments/hybrid-search/run-all.sh"
```

(Adjust the path to your repo location.)

## Why WSL?

| Blocker | Cause | WSL Fix |
|---------|-------|---------|
| **sqlite-vec** | Windows SQLite lacks extension loading | WSL uses Linux SQLite |
| **onnxruntime-node** | npm package has empty win32/x64 binaries | WSL uses Linux binaries |

## For Production (ai-memory)

When implementing hybrid search in the main package:

1. **Default:** Run MCP server in WSL when on Windows + semantic/hybrid enabled
2. **Or:** Document "semantic search requires Linux/Mac or WSL"
3. **Or:** Investigate Transformers.js WASM-only build for Node (no onnxruntime-node)
