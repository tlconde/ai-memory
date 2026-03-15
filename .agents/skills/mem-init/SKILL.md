---
name: mem-init
description: Initialize ai-memory in a new project. Scaffolds the .ai/ directory structure.
disable-model-invocation: true
---

# mem-init — Project Setup

## Instructions

1. Confirm the user wants to initialize ai-memory in this project
2. Ask: Default tier or Full tier (adds governance, evals, ACP)?
3. Run: `ai-memory init` (or `ai-memory init --full`)
4. Guide the user to edit `.ai/IDENTITY.md` and `.ai/DIRECTION.md`
5. Run `ai-memory validate` to confirm setup
