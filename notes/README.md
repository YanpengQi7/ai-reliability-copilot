# Notes index

This directory keeps evaluation evidence, design write-ups, and publication drafts separate so generated artifacts do not get confused with reviewed conclusions.

## Reviewed reports

- [`reports/eval-run-3.md`](reports/eval-run-3.md) — repeated prompt-version evaluation; version deltas were inside run-to-run noise.
- [`reports/agentic-harness.md`](reports/agentic-harness.md) — agent loop design and single-shot versus agentic results.
- [`reports/calib-grounding-findings.md`](reports/calib-grounding-findings.md) — stable, human-reviewed grounding-judge conclusions.

## Generated artifacts

These files are overwritten by scripts and should be treated as reproducible inputs, not edited narratives.

- [`generated/eval-agentic-latest.json`](generated/eval-agentic-latest.json) — `npm run evals:agentic`
- [`generated/crossjudge-latest.json`](generated/crossjudge-latest.json) — `npm run evals:crossjudge`
- [`generated/calib-grounding.md`](generated/calib-grounding.md) — `npm run calib:grounding`

## Archive

- [`archive/calib-grounding-chat.md`](archive/calib-grounding-chat.md) — original flat-ceiling judge calibration.
- [`archive/calib-grounding-reasoner.md`](archive/calib-grounding-reasoner.md) — reasoner calibration snapshot retained for comparison.

## Publication drafts

- [`drafts/blog-prompt-tuning-was-noise.md`](drafts/blog-prompt-tuning-was-noise.md)
- [`drafts/blog-prompt-tuning-was-noise-thread.md`](drafts/blog-prompt-tuning-was-noise-thread.md)

When adding a note, prefer a reviewed summary in `reports/` and put large machine-generated output in `generated/`. Historical snapshots belong in `archive/`; prose intended for external publication belongs in `drafts/`.
