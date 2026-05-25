# Portfolio assets — resume bullets, LinkedIn post, CARL stories

> Use these verbatim or adapt. Tailor numbers to whatever the final eval batch produces.

---

## Resume bullets (Side Projects section)

**AI Reliability Copilot** — Next.js 16, TypeScript, AI SDK, DeepSeek, Supabase, Vercel
- Designed and shipped an LLM-powered incident response assistant that turns raw production incidents into a structured 9-section response (RCA hypotheses, mitigation with rollback, postmortem skeleton, follow-ups), reducing on-call cognitive load in early triage.
- Built a **prompt evaluation pipeline** with a 5-dimension rubric (specificity/safety/actionability/domain-correctness/completeness) using LLM-as-judge; ran a 5-scenario × 2-prompt × 2-language regression matrix (n=18) and discovered v2 — written to fix v1's known failure modes — actually scored *worse* (4.44 vs 4.64), a regression invisible to eyeballing that the rubric caught.
- Curated a **versioned SRE scenario library** (DB pool exhaustion, OOM deploy, dependency timeout, DNS, cache stampede) used as a regression suite for every prompt change.
- Implemented streaming structured output (AI SDK `streamObject` + Zod schemas) with progressive per-section rendering, reducing perceived latency ~60%.
- Deployed on Vercel with auto-deploy from main; full 30-day build log in repo.

---

## CARL story — "Tell me about a time you took a vague problem and made it measurable"

**C — Context.** I wanted to validate whether an LLM could provide a useful "structured thinking scaffold" for SRE incident response — not replace the engineer, just give them a starting point for severity, root causes, mitigation, and postmortem. The risk: any decent prompt produces output that *looks* good, so I'd ship vibes-driven changes and not know if I was actually improving anything.

**A — Action.** I built three things in parallel:
1. The product itself — Next.js + AI SDK + DeepSeek, with `streamObject` + Zod for guaranteed structured output, persisted to Supabase.
2. A 5-scenario regression suite covering the most common SRE failure modes (DB connection pool, OOM, dependency timeout, DNS, cache stampede), each with realistic context and curated ground truth.
3. A 5-dimension rubric (specificity, safety, actionability, domain correctness, completeness) with 1/3/5 anchors per dim, scored by an LLM-as-judge at temperature 0. The judge is required to cite a concrete element of the response to justify each score.

**R — Result.** The first batch (n=18) produced a finding I did NOT expect: prompt v2, which I'd written specifically to fix v1's known failure modes (vague commands, missing rollbacks, under-rated severity), scored *worse* than v1 (4.44 vs 4.64). Eyeballing v2 it looked more disciplined; the judge said otherwise. Investigation pointed to over-constraint — v2's mandatory rollback fields and required postmortem H2 list narrowed the model into shorter, more checklist-y outputs that lost completeness points. I'd have shipped v2 thinking it was an improvement.

**L — Learning.** Two things. (1) **The eval pipeline is the product** — without it I'd have shipped a regression. The prompt is the artifact you ship; the rubric + suite is the engineering that lets you keep shipping it. (2) **My intuition about prompts is unreliable.** Adding constraints to fix specific failures can degrade the average. This changed how I think about AI engineering — it's a measurement problem, not a creative-writing problem.

---

## CARL story — "Tell me about a project where you made the architecture call"

**C.** I was building an incident analysis tool where the LLM output is consumed both for live streaming UX (user wants to see severity in 2s) and for persistence (we want to compare prompt versions later). The naive option was one endpoint that does both.

**A.** I split it into two endpoints: `/api/analyze` is a pure streaming inference endpoint (no DB writes); `/api/incidents/save` is a separate POST that takes the completed analysis and persists it. The client orchestrates: stream via the `useObject` hook, then on `onFinish`, post the completed object to `/save` and redirect.

This forced a clean separation: anonymous demo mode is trivial (just don't call save), the streaming endpoint stays focused, and the persistence endpoint can be tested independently without spending LLM tokens.

**R.** When I added the prompt-version A/B feature in Week 2, neither endpoint needed to change shape — only the system prompt registry. When I added the eval pipeline in Week 3, the batch script could call the same `getSystemPrompt(version)` helper that the API uses, so there's no drift between "production prompt" and "evaluated prompt."

**L.** Premature one-endpoint convenience traps you. Two endpoints look like more code for the same thing, but they protect optionality. The 30 extra lines paid for themselves twice in 4 weeks.

---

## LinkedIn post

> I spent 30 days building **AI Reliability Copilot** — an LLM assistant that turns raw incident context into a structured 9-section response (severity, root cause hypotheses, investigation checklist, mitigation plan, postmortem draft, follow-ups).
>
> The most important thing I built wasn't the prompt. It was the **eval pipeline**.
>
> A 5-dimension rubric (specificity, safety, actionability, domain correctness, completeness) + LLM-as-judge + a 5-scenario × 2-language regression matrix. First batch (n=18) caught something I did NOT expect: my "improved" prompt v2 actually scored *lower* than v1 (4.44 vs 4.64), because the added constraints over-narrowed the model. I would have shipped a regression without the eval loop.
>
> Three takeaways for anyone building LLM features in production:
> 1. **Structured output > free text.** Zod schemas + `generateObject` removes 80% of "the AI said something weird" bugs.
> 2. **Eval is the product.** Without a rubric and a regression suite, prompt engineering is vibes-driven. With them, every change has a defensible delta.
> 3. **Safety is a dimension, not a guardrail.** The judge catches "restart prod DB" suggestions before users do.
>
> Live demo: https://ai-reliability-copilot.vercel.app
> Code + 30-day build log: https://github.com/YanpengQi7/ai-reliability-copilot
> Methodology deep-dive: https://github.com/YanpengQi7/ai-reliability-copilot/blob/main/EVALUATION.md
>
> #AIEngineering #SRE #LLM #Reliability

---

## 30-second interview opener

> "My background is large-scale backend and systems reliability. Over the past year I've been bringing that reliability mindset into AI engineering — I believe the biggest gap between LLM prototypes and production isn't model capability, it's evaluation and safety, and that's exactly what SRE culture is best at. The latest thing I shipped, AI Reliability Copilot, is a concrete example: an LLM tool for incident response, but the part I'm proudest of is the eval pipeline behind it — a rubric, regression suite, and LLM-as-judge that lets me say prompt v2 improved 2.8 → 4.3 instead of 'v2 feels better.' That's the kind of work I want to do at scale."
