---
id: shell
type: toolbox
status: active
---

# Shell & CLI Patterns

How to use shell commands effectively with ai-memory.

## Feed command output to memory

| Command | Memory action |
|---|---|
| `git diff` | Feed to `validate_context` for governance checks |
| `npm test` / `pytest` | Capture failures in `debugging.md` |
| `npm run build` | Capture build errors and fixes |
| Deploy scripts | Record deployment decisions in `decisions.md` |
| `git log --oneline -20` | Use as context when writing session archive |

## Memory-aware shell patterns

Before running destructive commands:
1. `search_memory` for relevant patterns or warnings
2. Check `decisions.md` for any constraints on the operation
3. After completion, `commit_memory` with what happened

## CI/CD integration

In CI pipelines, use the ai-memory CLI directly:
```bash
# Validate memory health
npx @radix-ai/ai-memory eval --json

# Check governance rules
npx @radix-ai/ai-memory generate-harness
npx @radix-ai/ai-memory validate
```
