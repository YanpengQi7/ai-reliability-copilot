---
title: "I thought my prompt tuning raised quality 4%. Then I added repeats — it was noise."
slug: i-thought-my-prompt-tuning-raised-quality-4-percent-it-was-noise
date: 2026-06-03
description: "A single-shot eval gave me a clean prompt-version ranking and a tidy +4% improvement. Adding three repeats per cell showed the within-cell variance was larger than every gap I was measuring. Here's how to not fool yourself."
tags: [evals, llm, prompt-engineering, reliability]
---

I had a clean result. Prompt v3 scored 4.52, prompt v2 scored 4.36 — a tidy **+4% quality improvement** that I was about to write up as the payoff of a week of prompt work.

It was noise. Here's how I found out, and why I think single-shot LLM evals are quietly lying to a lot of people right now.

## The setup

I'm building an SRE incident copilot: paste in logs, metrics, and on-call notes, get back a structured analysis — severity, ranked root-cause hypotheses, a copy-pasteable investigation checklist, a mitigation plan with rollbacks. The interesting part isn't the prompt. It's that I refused to ship prompt changes on vibes, so I built an eval pipeline around it:

- A **5-dimension rubric** (specificity, safety, actionability, domain correctness, completeness), each scored 1–5 with explicit 1/3/5 anchors so scores are reproducible.
- A **regression suite** of 5 representative incident scenarios, so a prompt change is measured across breadth, not one cherry-picked example.
- An **LLM-as-judge** running at `temperature: 0`, scoring every analysis against the rubric.

This is already more rigor than most "I improved my prompt" claims survive. I ran it across 3 prompt versions × 2 output languages (English/Chinese) × 5 scenarios. One score per combination. And it gave me a story:

- **Run #1:** v2 *regressed* ~0.2 vs v1. My eval caught a regression I'd have shipped blind. 
- **Run #2:** I wrote v3 to fix v2's over-constraints. v3 came out on top, 4.52 vs v2's 4.36. The pipeline confirmed the recovery.

Two clean runs. A regression caught, a fix confirmed, a number to put in the README. This is the part where most eval write-ups stop.

## The one change that broke the story

Every single-shot score is one sample from a distribution. My analyzer runs at `temperature: 0.2` — non-zero — so the *same* prompt on the *same* scenario doesn't return the same text twice. Which means one score per cell isn't a measurement. It's a draw.

So I did the boring thing. I ran each cell **three times** and reported **mean ± standard deviation** instead of a single number.

The within-cell standard deviation came back at **0.2–0.46**. Every gap I had been comparing between prompt versions was **0.02–0.13**.

The error bars were bigger than the signal.

| version | overall (mean ± std), n=24 |
|---|---|
| v1 (rules-only) | 4.62 ± 0.33 |
| v2 (rules + few-shot, hard gates) | 4.48 ± 0.24 |
| v3 (gates → preferences + substance directive) | 4.60 ± 0.26 |

| comparison | Δ mean | pooled std | verdict |
|---|---:|---:|---|
| v1 − v2 | +0.13 | 0.29 | inside noise |
| v1 − v3 | +0.02 | 0.30 | inside noise |
| v2 − v3 | −0.12 | 0.25 | inside noise |

For these 5 scenarios and this rubric, **all three prompts are statistically tied.** The "v3 improved quality 4.36 → 4.52" claim was me overfitting to a lucky draw. The "v2 regressed" finding from run #1? Also inside the noise band. Both of my previous conclusions were over-claimed — and I'd have shipped run #2's number as a result if I hadn't added repeats.

## What actually survives error bars

Repeats don't just delete findings. They tell you which ones are real — and two effects held up across all three independent runs:

1. **v2 was the weakest in every run.** Each individual delta is in-noise, but the *ordering* reproduced 3 times out of 3. That consistency is weak-but-real evidence that v2's hard gates cost a little. Enough to say "don't default to v2"; not enough to quantify the cost.
2. **Chinese scored below English in nearly every cell** (en 4.64 ± 0.25 vs zh 4.49 ± 0.29). This was the most reproducible effect in the whole dataset — far more robust than any prompt-version gap. That's where the real signal is, and where I'll point future work.

So I did change my default prompt to v3 — but for an honest reason. Not "it scored higher" (it didn't, within noise). It's tied with v1 on quality *and* strictly better-maintained for the bilingual case: its Chinese brevity guard makes v3 ≥ v2 in Chinese in every scenario, at no measured cost in English. "Tied on quality, better engineered" is a defensible reason to ship. "+4%" was not.

## The takeaways I'd actually generalize

**If your generation step has `temperature > 0`, a single eval score is a sample, not a measurement.** You cannot separate a real prompt effect from run-to-run variance without repeats. Mean ± std is the cheapest insurance against shipping noise as a result — it cost me one flag (`EVAL_REPEATS=3`) and 3× the API spend, which on this project was about nine cents.

**A ceiling effect hides this.** Most of my cells score 4–5, which compresses the gaps and makes integer-rounded rubric scores look more decisive than they are. If you're scoring in a narrow band, you need *more* repeats, not fewer, to say anything.

**"My eval caught a regression" is a weaker brag than it sounds.** The grown-up version is "my eval told me my own previous conclusion was over-claimed." Being willing to run the experiment that deletes your nice result is the actual discipline.

## The limitation I'm not hand-waving

Here's the honest ceiling on everything above: my judge is the same model family as my analyzer. It's grading a relative of its own output. I expect a 10–20% optimistic bias, and **mean ± std only proves a score is *stable*, not that it's *correct*.** I've made my measurements precise; I haven't yet shown they're accurate.

So I ran the first version of the experiment that probes that gap. I had an *independent annotator from a different model family* (Claude, where the analyzer and judge are both DeepSeek) blind-score 18 analyses, then compared it to the judge. The result was sharper than I expected:

- The judge agrees within ±1 point **97.8%** of the time — it's never wildly off.
- But it rated **higher on all 18 analyses** (mean bias **+0.36**, never once lower). The optimism I'd only hypothesized in my limitations section is real and one-directional.
- And its *rank* agreement was weak (Spearman ρ ≈ 0.30) — for the **same reason** the prompt comparison was inconclusive. When almost everything scores 4–5, there's barely any rank signal left to agree on. The ceiling effect that hid the prompt differences also limits how well any two graders can agree on ordering.

That's cross-family agreement, not human ground truth — a human labeling pass is still the honest gold standard, and it's the next thing I owe this project. But even the cheap version turned "I think my judge is biased" into "my judge is biased by +0.36, always upward, and the rubric's ceiling is the thing to fix." If the judge had tracked the independent grader perfectly, that would've earned the pipeline trust. It didn't — and that's a more useful finding than any prompt comparison.

That's the loop I think reliability work on LLMs actually is: not "I tuned a prompt," but "I built enough instrumentation to know when a number is real — including when it tells me I was wrong."

---

*Code, the full run #3 write-up with per-cell variance, and the eval harness are open source: [AI Reliability Copilot](https://github.com/YanpengQi7/ai-reliability-copilot). More on evals: [Agent systems need evals before they need more tools](https://yanpengqi.com/blog/agent-systems-need-evals-before-they-need-more-tools).*
