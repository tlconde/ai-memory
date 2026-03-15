# Eval Metrics

Objective metrics used to compare Agent A (ai-memory) vs Agent B (baseline). No metric is inherently "better" — interpret in context.

## Structural Metrics

### Completeness (0–4)
**What:** Count of required sections present: friction (iter1), options (iter2), recommendation, implementation steps.

**Interpretation:** Higher = more complete response. All agents should aim for 4. Low score = missed deliverable.

**Limitation:** Presence only, not quality.

---

### Friction Coverage (%)
**What:** % of significant terms from iter1 (friction list) that appear in iter4 (recommendation).

**Interpretation:** Higher = recommendation addresses more of the friction the agent identified. Measures structural consistency: does the solution map to the problem?

**Limitation:** Keyword overlap only. A term can appear without being addressed. False positives (e.g. "config" in both) and false negatives (synonyms) possible.

---

### Options–Recommendation Alignment (%)
**What:** % of significant terms from iter2 (options) that appear in iter4 (recommendation).

**Interpretation:** Higher = final recommendation aligns with the options the agent proposed. Measures internal consistency across iterations.

**Limitation:** Same as friction coverage — keyword-based.

---

### Recommendation Specificity (numbered steps)
**What:** Count of numbered items (1., 2., …) in the implementation steps section.

**Interpretation:** More steps = more actionable. Zero = recommendation may be vague.

**Limitation:** Count only. A single vague step counts as 1; five concrete steps count as 5. Quality of steps not measured.

---

## Consistency Metrics

### Repetition (Jaccard %)
**What:** Jaccard similarity of word sets between iter1 and iter4. |A∩B| / |A∪B|.

**Interpretation:** Higher = more word overlap. Can mean:
- **Consistency:** iter4 builds on iter1 (good)
- **Repetition:** iter4 recycles iter1 content (bad)

**Interpret in context.** Neither agent is favored by design.

**Limitation:** Word-level only. No semantic understanding.

---

### Self-Contradiction (boolean)
**What:** Heuristic: does the recommendation section contain negation of recommendation (e.g. "not recommend", "avoid")?

**Interpretation:** If true, possible confusion. **Manual review required.** Not definitive.

**Limitation:** Very coarse. Many contradictions won't match this pattern.

---

## Behavioral Metrics (not quality)

### Used Memory
**What:** Did the agent use search_memory or read .ai/memory/?

**Interpretation:** Agent A should be true; Agent B should be false. Validates setup.

---

### Ran Compound
**What:** Did Agent A run /mem-compound after iter 2?

**Interpretation:** Agent A should be true; Agent B N/A. Validates flow.

---

### Tokens / Context
**What:** Extracted from trace if reported.

**Interpretation:** Efficiency signal. Lower tokens for same completeness = more efficient. Not a quality metric.

---

## What We Do NOT Measure

- **Semantic quality** of recommendations (requires LLM-as-judge or human)
- **Correctness** of implementation steps (requires domain expertise)
- **True contradictions** (requires semantic understanding)
- **Coherence** beyond structural presence

---

## Avoiding Bias

- All metrics are symmetric: both agents evaluated identically.
- No "more is better" default: repetition can be good or bad; word count is not a quality proxy.
- Document limitations for each metric.
- When comparing, state what each metric measures and how to interpret it.
