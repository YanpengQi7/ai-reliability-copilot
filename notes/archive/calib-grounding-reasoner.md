# Evidence-grounding calibration audit

Generated 2026-06-04T23:00:06.052Z. Grounding judge: **deepseek-reasoner**. Independent deterministic cross-check of the judge's evidence_grounding score.

For each agentic run: **judge score** (1-5, DeepSeek) vs **grounded ratio** (numeric/metric claims in the analysis that actually appear in the trace).
A high judge score next to a low grounded ratio = lenient judge. Ungrounded tokens are listed for human review (some are false negatives — paraphrase/derived — flagged for eyeballing).

| scenario | lang | judge | grounded ratio | ungrounded tokens |
|---|---|---|---|---|
| db-connection-pool-exhausted | en | 5 | 19/23 (83%) | `5mi`, `30.`, `500/500`, `87,s` |
| bad-deploy-memory-leak | en | 1 | 13/18 (72%) | `3.2%`, `1%`, `5mi`, `7,`, `3%` |
| upstream-dependency-timeout | en | 5 | 15/16 (94%) | `5mi` |
| dns-misconfiguration | en | 4 | 14/18 (78%) | `5mi`, `2,`, `1%`, `09.` |
| cache-stampede | en | 5 | 15/19 (79%) | `1%`, `5mi`, `00,`, `02.` |

## Verdict

- Mean judge grounding score: **4.00 / 5** (= 80% of ceiling)
- Mean deterministic grounded ratio: **81%** of evidence tokens traceable
- Gap: scores roughly agree.

> Caveat: the deterministic check undercounts — paraphrased or derived claims (e.g. 'connection pool exhausted' with no number) won't match a token even when fully grounded. Treat the ratio as a FLOOR on grounding and eyeball the ungrounded list.