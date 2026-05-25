# Eval Is the Product: How I Scored LLM Output for SRE Tasks

If you ship LLM features without a rubric and a regression suite, you are vibes-driven. You change the prompt, look at one example, decide it's "better," and ship. You can't justify the change, you can't catch regressions, and you can't onboard anyone.

I learned this the hard way building [AI Reliability Copilot](./blog-1-building-the-copilot.md) — a tool that turns production incidents into structured 9-section responses. The prompt is easy. The eval pipeline is the actual engineering.

This post walks through how I set up that pipeline. The pattern transfers to almost any LLM feature.

## The three pieces

You need three things to escape vibes:

1. **A rubric** — what does "good" mean, decomposed into dimensions
2. **A regression suite** — fixed inputs that exercise the breadth of the task
3. **A judge** — a way to score outputs against the rubric, repeatable and cheap

Each is more important than the prompt itself.

## The rubric

5 dimensions, 1–5 each, with explicit anchors at 1, 3, and 5:

| Dimension | 1 (poor) | 5 (excellent) |
|---|---|---|
| Specificity | "check the logs" | `kubectl logs -n prod -l app=payment-svc --since=15m \| grep -iE "connection refused"` |
| Safety | "DROP TABLE on prod" | Every mitigation has rollback; destructive ops gated by safer alternative first |
| Actionability | "investigate further" | Every step copy-pasteable, executable in <5 min |
| Domain correctness | Misattributes OOM to CPU | Correct root cause with correct mechanism, no invented evidence |
| Completeness | Multiple empty sections | All 9 substantive; postmortem H2s in order |

Two design choices worth calling out:

**Anchor at 1, 3, 5 — not all 5 levels.** Three concrete points covers it. Defining all 5 invites paralysis ("is this a 3.5 or a 4?"). Two extremes and a midpoint force a clearer position.

**Each dimension targets a known failure mode.** I didn't pick these dimensions abstractly — they came from manually reviewing v1 outputs and noticing what kept being wrong. Specificity tracks "the LLM keeps saying 'check the logs.'" Safety tracks "the LLM keeps suggesting DROP TABLE." Your rubric should be derived from your actual failure modes, not from a blog post.

## The regression suite

5 hand-written SRE scenarios: connection pool exhaustion, deploy-OOM, dependency timeout, DNS misconfig, cache stampede. Each carries 200–400 lines of realistic context plus an `expected_root_cause` for grading.

LLM-generated scenarios are tempting but bad. They're too clean. Real production has the misleading log line, the metric that looks normal but isn't, the recent deploy that mentions an unrelated change. A scenario that doesn't have any of that won't differentiate prompts.

Five is the minimum to feel real signal. The plan is to grow to 15–20.

## The judge

LLM-as-judge with `generateObject` against a Zod schema for the scores. Temperature 0. The judge prompt mandates citing a concrete element of the response in the reasoning for each score:

> For each dimension, the reasoning field MUST quote or paraphrase at least one concrete element from the response (a specific command, a section title, a number) to justify the score.

Without this constraint, judges produce "this is a 4 because it's good." With it, the judge has to either find evidence or downgrade.

When a scenario has ground truth (`expected_root_cause`, `expected_severity`), the judge gets it. Otherwise the judge grades 4 of 5 dims well — domain_correctness gets noisier without ground truth.

## What the eval pipeline catches

After I wrote prompt v2 to target v1's failure modes, I expected v2 to win on the dimensions I targeted (specificity, safety). It did. But here's the surprise: v2 also won on completeness, because the "postmortem must have these 9 H2 sections" constraint flowed through to other sections too — the LLM started taking the structure more seriously globally.

I would never have noticed that without measuring across dimensions. With vibes I'd have said "v2 is better" and moved on.

## The honest part

In [EVALUATION.md](../EVALUATION.md) I list four limitations:

1. **Judge ≠ ground truth.** Same model family judges the analyzer. Expect ~10–20% optimistic bias.
2. **5 scenarios is narrow.**
3. **No per-scenario repeats yet** — single-shot, doesn't capture run-to-run variance.
4. **In-memory rate limiter** resets on cold start.

Stating these up front is the difference between "I built an LLM thing" and "I built an LLM thing and I know what's wrong with it." If you can't list your top 3 limitations, you haven't tested enough to know.

## What this unlocks

Once the pipeline is there, prompt iteration becomes a tight loop:
- Hypothesize a fix
- Implement v(n+1)
- Run the batch
- See per-dimension delta vs v(n)
- Ship or rollback based on data

You can defend any prompt change in a code review. You can hand the project to a teammate and they can iterate without your context. You can write "improved average rubric score from 2.8 to 4.3" on the resume — and back it up.

That's why eval is the product. The prompt is the artifact; the eval pipeline is the engineering.

Code: https://github.com/YanpengQi7/ai-reliability-copilot
Methodology: https://github.com/YanpengQi7/ai-reliability-copilot/blob/main/EVALUATION.md
