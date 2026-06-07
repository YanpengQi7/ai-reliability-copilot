# Thread / long-post version (X, LinkedIn)

**1/**
I had a clean result: prompt v3 scored 4.52, v2 scored 4.36 on my LLM eval. A tidy +4% improvement I was about to ship as the payoff of a week of prompt work.

It was noise. Here's how I caught myself 🧵

**2/**
Setup: an SRE incident copilot scored by an eval pipeline — a 5-dimension rubric (1–5, anchored), a 5-scenario regression suite, an LLM-as-judge at temp 0. More rigor than most "I improved my prompt" claims survive.

One score per (version × language × scenario).

**3/**
Two clean runs:
• Run #1: v2 "regressed" 0.2 — eval caught a regression I'd have shipped blind
• Run #2: wrote v3 to fix it, v3 came out on top

Regression caught, fix confirmed, number for the README. This is where most eval write-ups stop.

**4/**
But my analyzer runs at temperature 0.2. Same prompt + same scenario ≠ same output. So one score per cell isn't a measurement — it's a single draw from a distribution.

So I did the boring thing: ran each cell 3× and reported mean ± std.

**5/**
Within-cell std: 0.2–0.46.
Every gap I'd been comparing between versions: 0.02–0.13.

The error bars were bigger than the signal.

v1 4.62±0.33 · v2 4.48±0.24 · v3 4.60±0.26 — all three prompts statistically tied. The +4% was a lucky draw.

**6/**
What survives repeats (the real findings):
• v2 weakest in all 3 runs — ordering reproduces even if each delta is in-noise. "Don't default to v2."
• Chinese < English in nearly every cell — most reproducible effect in the data. That's where the real signal is.

**7/**
I still moved my default to v3 — but honestly: not "it scored higher" (it didn't, within noise). It's tied with v1 on quality AND better-maintained for the bilingual case. "Tied on quality, better engineered" ships. "+4%" doesn't.

**8/**
Generalize:
If your gen step has temp > 0, a single eval score is a sample, not a measurement. Mean ± std is the cheapest insurance against shipping noise as a result. Cost me one flag and ~9¢ of API spend.

**9/**
The real limitation I'm not hand-waving: my judge is the same model family as the analyzer. Mean ± std proves a score is *stable*, not *correct*.

Next experiment: hand-label 20 analyses, measure human-vs-judge correlation. If the judge is wrong, that beats any prompt comparison.

**10/**
The grown-up version of "my eval caught a regression" is "my eval told me my own previous conclusion was over-claimed."

Being willing to run the experiment that deletes your nice result is the actual discipline.

Full write-up + open-source harness 👇
yanpengqi.com/blog/i-thought-my-prompt-tuning-raised-quality-4-percent-it-was-noise
