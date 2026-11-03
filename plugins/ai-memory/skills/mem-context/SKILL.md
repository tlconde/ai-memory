---
name: mem-context
description: Create and maintain the small .ai/context navigation pack. Use after repo structure changes, context drift, or context verify warnings.
---

# mem-context — Maintain Repo Navigation Context

## When to run

- First setup of the checked-in context pack
- Code changes altered entrypoints, risky paths, invariants, or search boundaries
- A hook asks you to reconcile session learnings into `.ai/context`
- `ai-memory context verify` reports stale or missing context

## Steps

### 1. Ensure the pack exists

If `.ai/context/` is missing, run:

```bash
ai-memory context init
```

### 2. Read before editing

Read these files:

1. `.ai/context/START_HERE.md`
2. `.ai/context/CODE_MAP.md`
3. `.ai/context/INVARIANTS.md`
4. `.ai/context/search-scope.json`

If `.ai/temp/pre-compact-dump.json` exists, read it first and preserve the user's latest intent.

### 3. Draft first

Write uncertain notes to `.ai/temp/context/drafts/`. Promote only concise, evidence-backed changes into `.ai/context/`.

### 4. Update only what changed

- `CODE_MAP.md` for important new or moved paths
- `INVARIANTS.md` for rules verified against the repo
- `search-scope.json` for task-specific search boundaries and verification shortcuts
- `acceptance.md` for quick checks proving the pack points to the right files

Do not store external library docs here. Use Context7 for current third-party docs.

### 5. Verify

Run:

```bash
ai-memory context verify
```

Fix failures before reporting done. Warnings may remain if you explain why.
