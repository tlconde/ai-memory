---
name: parallel-safe-planning
description: When coordinating sub-agents or parallel execution, design tasks that do not create code conflicts.
alwaysApply: true
---

When creating a plan or task list that will be executed by multiple agents or sub-agents (worktrees, background agents, parallel sessions):

1. **Each task must touch a distinct set of files.** Two tasks should never modify the same file. If they must, one should depend on the other (sequential, not parallel).

2. **Scope tasks by module, not by layer.** "Add login feature" is parallelizable. "Update all controllers" is not — it touches files other tasks may also touch.

3. **Mark dependencies explicitly.** If task B requires task A's output, say so: `depends_on: task-a`. Agents will claim independent tasks first.

4. **Shared files go last.** Tasks that modify shared files (config, routes, index exports) should be a final sequential step, not parallelized.

5. **Test tasks are independent.** Writing tests for module X does not conflict with writing tests for module Y. These can always run in parallel.

When using `claim_task`, agents will pick unclaimed tasks. If the task breakdown follows these rules, two agents claiming different tasks will never produce merge conflicts.
