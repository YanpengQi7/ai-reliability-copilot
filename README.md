# AI Reliability Copilot

> Turn incident chaos into a structured 9-section response in seconds.

Paste a production incident — logs, metrics, on-call notes. The copilot streams back a structured analysis: severity, ranked root-cause hypotheses with evidence, a copy-pasteable investigation checklist, a mitigation plan with rollback steps, customer-facing impact, postmortem skeleton, and prioritized follow-ups.

But the real story isn't the prompt. It's the **eval pipeline** — a 5-dimension rubric, a 5-scenario regression suite, and an LLM-as-judge that scores every change, so prompt iteration is measured instead of vibes-based.

**Live demo:** [ai-reliability-copilot.vercel.app](https://ai-reliability-copilot.vercel.app)
**📖 Usage guide (中文):** [USAGE.md](./USAGE.md) — how to actually use it, end-to-end
**Methodology deep-dive:** [EVALUATION.md](./EVALUATION.md)
**30-day build log:** [`notes/`](./notes/)

---

## Architecture

```
   ┌───────────────────┐      ┌───────────────────┐      ┌──────────────────┐
   │   Browser (RSC)   │◀────▶│  Next.js 16 App   │◀────▶│ DeepSeek (AI SDK)│
   │   experimental_   │      │  Router on Vercel │      │  generate/stream │
   │   useObject hook  │      │  (Fluid Compute)  │      │      Object      │
   └───────────────────┘      └─────────┬─────────┘      └──────────────────┘
                                        │
                                        ▼
                              ┌───────────────────┐
                              │   Supabase (PG)   │
                              │  incidents /      │
                              │  analyses /       │
                              │  scenarios /      │
                              │  evaluations      │
                              └───────────────────┘
```

- **Next.js 16** App Router, RSC for read-heavy pages (incident list/detail, evals dashboard); client components only where needed (streaming form, copy buttons)
- **AI SDK** with `streamObject` + Zod schema for guaranteed structured output
- **DeepSeek** for both analyzer and judge (provider-swappable in one file)
- **Supabase Postgres** for persistence; service-role client server-side only
- **Vercel** auto-deploys on push to `main`

## The 9-section output schema

Enforced by Zod ([`src/lib/schema.ts`](./src/lib/schema.ts)):

1. **Summary** + severity badge with quantitative reasoning
2. **Severity** (SEV1/2/3) — apply rubric strictly
3. **Root cause hypotheses** (3–5, ranked by likelihood with cited evidence)
4. **Investigation checklist** (copy-pasteable commands, expected outputs)
5. **Mitigation plan** (with risk + mandatory rollback per step)
6. **Customer impact** (externally-facing)
7. **Postmortem draft** (markdown, all H2 sections in order)
8. **Follow-ups** (P0–P2, tied to owner roles)
9. **Severity reasoning** (citing the rubric rule applied)

## Prompt engineering, measured

Every prompt iteration is tracked against the same 5-scenario regression suite × 2 output languages (en/zh), scored by an LLM judge against a 5-dimension rubric.

| Dimension | What it measures |
|---|---|
| Specificity | Are commands/metrics/services concrete? |
| Safety | Is every mitigation reversible? Are destructive ops gated? |
| Actionability | Can on-call execute in <5 min without further research? |
| Domain correctness | Right SRE mechanism? No invented evidence? |
| Completeness | All 9 sections substantively filled? |

### Latest results (n=18, deepseek-chat for both analyzer and judge)

| | overall (1–5) |
|---|---|
| **Prompt v1** (rules-only) | **4.64** |
| **Prompt v2** (rules + anchors + few-shot) | **4.44** |
| **English output** | **4.60** |
| **Chinese output** | **4.47** |

**Surprising finding:** v2 — which I wrote specifically to fix v1's known failure modes (vague commands, missing rollbacks, severity under-rating) — scored *worse* on average. Likely cause: the additional constraints (mandatory rollback fields, required postmortem H2 list, etc.) over-narrow the model and it produces shorter, more checklist-y responses that the judge marks down on completeness. This is exactly the kind of regression you can only catch with a measured rubric — eyeballing v2 output it "looks more disciplined," but the judge disagrees. Investigating in v3.

**Cross-lingual finding:** Chinese output scored ~0.13 lower on average. Per-dim breakdown points the loss to `actionability` (Chinese explanations are slightly more verbose, pushing commands into walls of prose). Codes/commands themselves were correctly kept in English (the prompt's `languageInstruction()` works).

See [EVALUATION.md](./EVALUATION.md) for the full methodology, including limitations and roadmap.

## Scenario library

5 curated SRE scenarios cover the most common production failure modes:

| Scenario | Category |
|---|---|
| Payment-svc connection pool exhausted | Database |
| Order-svc OOM crashloop after deploy | Deploy |
| Stripe API timeout cascading into checkout outage | Dependency |
| Regional 5xx after DNS misconfiguration | Network |
| Black Friday cache stampede | Capacity |

Each has enough context (metrics, logs, deploy history, on-call notes) to differentiate prompt versions. Browse them at `/scenarios`.

## Use it from your own Claude Code (MCP server mode)

This project ships as **both a web app and an MCP server**. Power users add the MCP endpoint to their local Claude Code and drive analysis with their own Claude subscription — the platform pays $0 in LLM costs, the user gets Claude Opus quality.

```bash
claude mcp add --transport http ai-reliability https://ai-reliability-copilot.vercel.app/api/mcp
```

7 tools exposed: `search_kb`, `find_similar_incidents`, `list_scenarios`, `get_scenario`, `parse_alert_json`, `get_output_schema`, `save_incident_analysis`. See [USAGE.md](./USAGE.md) workflow D-bis for the full pattern.

## Knowledge base (internal RAG)

Make the AI understand **your company**: drop your runbooks, postmortems, and service catalog into `sample-kb/` (or any directory), then `npm run kb:ingest`. Every subsequent analysis automatically retrieves the top-5 most relevant chunks and injects them into the prompt as `# Internal context`, so the LLM grounds its answer in *your* systems instead of generic SRE advice.

- **Storage:** `kb_documents` (one row per file, dedupe by content hash) + `kb_chunks` (paragraph-aware chunks ~1500 chars with 150-char overlap)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim) when `OPENAI_API_KEY` is set; **falls back to pg_trgm** otherwise
- **Audit trail:** `analysis_kb_chunks` records which chunks fed which analysis with their similarity scores. Detail page shows "📚 Internal docs used by the AI" with bracket-numbered citations matching what was in the prompt.
- **CLI:** `npm run kb:ingest -- ./docs/runbooks` (idempotent via SHA256 content hash, skip-if-unchanged)
- **Sample docs** in `sample-kb/` show what's expected — replace with yours.

The signature for similarity retrieval is the chunk text itself. Service-catalog snippets, runbook playbook steps, and past postmortems all index correctly.

## Similar-incident search

Every incident gets a **signature** (concatenation of title + service + symptoms + summary + severity) and, when `OPENAI_API_KEY` is configured, a **1536-dim embedding**. The detail page shows up to 5 past incidents ranked by similarity.

Two backends, chosen at runtime:
- **`pgvector` + HNSW + cosine distance** — semantic match (preferred). Embeddings from `text-embedding-3-small` ($0.02/M tokens). Returns matches above `1 - cosine_distance > 0.4`.
- **`pg_trgm`** — lexical fallback when no embedding provider is configured. Returns matches with trigram similarity > 0.15.

The choice is automatic and shown in the UI (`semantic match (pgvector)` vs `lexical match (pg_trgm)`). Migration to OpenAI later is one env var away; existing rows backfill via `npm run backfill:similar`.

The signature deliberately excludes `raw_context` — logs and timestamps dominate that field and produce noisy matches.

## Run locally

```bash
git clone https://github.com/YanpengQi7/ai-reliability-copilot
cd ai-reliability-copilot
npm install

# env: create .env.local with
#   DEEPSEEK_API_KEY=
#   NEXT_PUBLIC_SUPABASE_URL=
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=
#   SUPABASE_SERVICE_ROLE_KEY=

# DB: in Supabase SQL editor, run supabase/schema.sql

# seed the scenario library
npm run seed:scenarios

# dev
npm run dev   # → http://localhost:3000

# run the eval batch (writes to your Supabase)
npm run evals:run
```

## Known limitations

- **In-memory rate limiter** (`src/lib/rateLimit.ts`) — resets on cold start. Production swap: Upstash Redis.
- **Judge ≠ ground truth** — same model family judges the analyzer. ~10–20% optimistic bias likely. Mitigation: periodic human review (see EVALUATION.md).
- **No per-scenario repeats** — single-shot evaluation. Doesn't capture run-to-run variance.
- **5 scenarios is narrow** — real production has long tails.

## Tech stack

- Next.js 16 (App Router, RSC, Turbopack), TypeScript, Tailwind v4
- Vercel AI SDK 6 (`streamObject`, `generateObject`, `experimental_useObject`)
- DeepSeek API (analyzer + judge)
- Supabase (Postgres, service-role client on server)
- Zod (schemas everywhere — DB inserts, LLM outputs, API inputs)
- react-markdown + `@tailwindcss/typography` for postmortem rendering

## License

MIT

---

Built in 30 days as a side project to learn AI engineering and evaluation methodology. The full daily build log lives in [`notes/`](./notes/).
