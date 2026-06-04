# Evidence-grounding calibration audit

Generated 2026-06-04T22:56:26.470Z. Independent deterministic cross-check of the judge's evidence_grounding score.

For each agentic run: **judge score** (1-5, DeepSeek) vs **grounded ratio** (numeric/metric claims in the analysis that actually appear in the trace).
A high judge score next to a low grounded ratio = lenient judge. Ungrounded tokens are listed for human review (some are false negatives — paraphrase/derived — flagged for eyeballing).

| scenario | lang | judge | grounded ratio | ungrounded tokens |
|---|---|---|---|---|
| db-connection-pool-exhausted | en | 5 | 18/23 (78%) | `5mi`, `30.`, `87.`, `41.`, `3mi` |
| bad-deploy-memory-leak | en | 5 | 13/18 (72%) | `5mi`, `3.2%`, `3%`, `00,`, `7.` |
| upstream-dependency-timeout | en | 5 | 12/14 (86%) | `5mi`, `35.s` |
| dns-misconfiguration | en | 5 | 15/20 (75%) | `2,`, `1%`, `5mi`, `09.`, `02.` |
| cache-stampede | en | 5 | 14/18 (78%) | `5mi`, `1%`, `00,`, `02.` |

## Verdict

- Mean judge grounding score: **5.00 / 5** (= 100% of ceiling)
- Mean deterministic grounded ratio: **78%** of evidence tokens traceable
- Gap: judge looks LENIENT — it scored 5.0/5 while only 78% of claims are traceable. Tighten the grounding anchors / use a stronger judge before quoting grounding as a win.

> Caveat: the deterministic check undercounts — paraphrased or derived claims (e.g. 'connection pool exhausted' with no number) won't match a token even when fully grounded. Treat the ratio as a FLOOR on grounding and eyeball the ungrounded list.