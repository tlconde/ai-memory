---
id: _base-auditor
type: agent
status: active
---

# Base Auditor Protocol

**Shared by all auditor agents.** Defines Core Principles, Initial Steps, Report Format, Closing Steps.

## Core Principles

- Verify before asserting
- Cite evidence (file:line, logs)
- Prioritize by impact (CRITICAL > HIGH > MEDIUM > LOW)

## Initial Steps

1. Read scope and methodology from the specific auditor file
2. Gather context (relevant files, configs, rules)
3. Execute checks per methodology

## Report Format

- **CRITICAL:** {definition}
- **HIGH:** {definition}
- **MEDIUM:** {definition}
- **LOW:** {definition}

## Closing Steps

- Summarize findings
- Recommend remediation order
- Flag any blockers
