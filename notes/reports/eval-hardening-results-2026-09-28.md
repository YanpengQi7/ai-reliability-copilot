# Evaluation hardening: development pilot results

These are synthetic development cases awaiting human review. Prompts and data changed during iteration, so the pass counts below are not independent evidence of improved generalization.

| Run | Fixed workflow passes | Agent passes | Estimated total cost (including judge) |
|---|---:|---:|---:|
| challenge-pilot-20260927 | 4/6 | 2/6 | $0.049812 |
| challenge-refined-20260927 | 5/6 | 5/6 | $0.052903 |
| challenge-scoped-20260927 | 6/6 | 6/6 | $0.053253 |

Total estimated cost was $0.155968, below the $0.20 budget.

The first run exposed missing alert citation IDs, invalid derivations, and inappropriate severity downgrades for small affected-user populations. After citation and severity-prompt fixes, the second run revealed that some draft cases supplied only request failure rates, which did not justify their expected user-impact severity. The third run added explicit affected-user scope to these synthetic cases. Earlier runs and dataset snapshots were preserved.

Both approaches ultimately passed all six development cases, with 100% retrieval of required evidence. However, the agent's generation cost per successful outcome was approximately 3.21 times that of the fixed workflow, exceeding the cost gate. Labels remain unreviewed, the judge lacks human calibration, and the pilot covers only six incident families. The release decision remains **inconclusive**.

Validation at the time of this pilot: 220 tests passed, along with type checking, linting and the production build. Offline resume, independent rescoring, calibration, and rejection of altered human-review content also passed.

Raw runs and human-review directories remain local and are ignored by Git. The public page loads only explicitly exported synthetic aggregates.
