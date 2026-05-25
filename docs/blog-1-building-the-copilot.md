# Building AI Reliability Copilot: A 30-Day Side Project

I spent 30 days building an LLM-powered incident response assistant: paste a production incident, get back a structured 9-section response (severity, root-cause hypotheses, investigation checklist, mitigation, postmortem draft, follow-ups).

But the most important thing I built wasn't the prompt. It was the eval pipeline — a 5-dim rubric, a 5-scenario regression suite, and an LLM-as-judge that lets me say "v2 scored 4.3 vs v1's 2.8" instead of "v2 feels better."

This post walks through the build. The follow-up [Eval Is the Product](./blog-2-eval-is-the-product.md) goes deep on the evaluation methodology — that's the part worth your time if you build LLM features.

## Week 1 — MVP

Stack choice: Next.js 16 App Router + AI SDK + DeepSeek + Supabase. The non-obvious one is DeepSeek over OpenAI: 10x cheaper, AI SDK adapter is one line, quality is fine for this task.

Three architectural choices that paid off:

**1. Zod schema as the single source of truth.** The 9-section output is defined once in `src/lib/schema.ts` and consumed by `generateObject` (LLM output), Supabase inserts (DB), and the React rendering (UI). When I added `severity_reasoning`, exactly one file changed and TypeScript walked me through the rest.

**2. `streamObject` instead of `generateObject`.** Perceived latency drops from "stare at a spinner for 20s" to "see severity + summary at ~2s." The AI SDK's `experimental_useObject` hook handles partial-object rendering on the client — every render gates on whether a field is defined yet.

**3. Two endpoints, not one.** `/api/analyze` streams; `/api/incidents/save` persists. The client calls them in sequence. This keeps streaming clean and lets me add an anonymous demo mode trivially.

## Week 2 — Scenario library

Five hand-written scenarios covering the most common SRE failure modes: DB connection pool exhaustion, deploy-induced OOM, third-party dependency timeout, DNS misconfiguration, cache stampede. Each has 200–400 lines of realistic context (metrics, log snippets, deploy history, on-call Slack notes) plus an `expected_root_cause` for later grading.

Why hand-written and not "generate scenarios with an LLM"? Because the scenarios need to differentiate prompts. LLM-generated scenarios tend to be too clean — they don't include the misleading log line that tricked the on-call into the wrong diagnosis, or the metric that looks normal but isn't.

After running v1 through all 5, I noted 5 recurring failure modes (see [week-1-findings.md](../notes/week-1-findings.md)) and wrote v2 to specifically target them. Side-by-side observations went into [week-2-findings.md](../notes/week-2-findings.md). But everything until then was vibes-based — I was eyeballing outputs and saying "this is better." Time to fix that.

## Week 3 — Eval pipeline

This is the part that turns a prompt project into an engineering project.

Rubric, 5 dimensions, 1–5 each, with anchors at 1/3/5:
- Specificity, Safety, Actionability, Domain correctness, Completeness

LLM-as-judge using DeepSeek (`temperature: 0`), prompted to cite a concrete element of the response to justify each score. Ground truth from the scenario gets injected when available.

`scripts/run-evals.ts` runs 5 scenarios × 2 prompt versions = 10 generations + 10 judgements, prints a summary table, persists everything. The `/evals` dashboard aggregates by `prompt_version`.

The honest part — I write about limitations in [EVALUATION.md](../EVALUATION.md): the judge has optimistic bias (same model family), 5 scenarios is narrow, no per-scenario repeats yet. Calling these out before someone asks is what separates "I built an LLM thing" from "I built an LLM thing and I know exactly what's wrong with it."

## Week 4 — Packaging

Deploy on Vercel (auto from `main`), README, this blog post, architecture diagram, and the portfolio bullets I'll be using on the resume.

## What I'd do differently
- Skip shadcn/ui — the CLI was interactive-only and would have blocked the Day 1 momentum. Raw Tailwind was fine.
- Start the eval pipeline in Week 1, not Week 3. Every prompt change before that was unmeasured. The build would have been faster overall.
- Add cost tracking from Day 1. I now have to back-fill it from DeepSeek dashboard exports.

Code: https://github.com/YanpengQi7/ai-reliability-copilot
Demo: https://ai-reliability-copilot.vercel.app
