-- AI Reliability Copilot — DB schema
-- Run this in Supabase SQL editor (or via `supabase db push` after `supabase link`)

create extension if not exists "pgcrypto";

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  raw_context text not null,
  service text,
  symptoms text,
  created_at timestamptz default now()
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  model text,
  prompt_version text,
  output_language text default 'en',
  summary text,
  severity text,
  severity_reasoning text,
  root_causes jsonb,
  investigation_checklist jsonb,
  mitigation_plan jsonb,
  customer_impact text,
  postmortem_draft text,
  follow_ups jsonb,
  latency_ms int,
  tokens_in int,
  tokens_out int,
  cost_usd numeric,
  created_at timestamptz default now()
);

create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text,
  category text,
  context text,
  expected_root_cause text,
  expected_severity text,
  created_at timestamptz default now()
);

create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references analyses(id) on delete cascade,
  rubric_version text,
  scores jsonb,
  overall numeric,
  judge_model text,
  judge_notes text,
  created_at timestamptz default now()
);

create index if not exists incidents_created_at_idx on incidents (created_at desc);
create index if not exists analyses_incident_id_idx on analyses (incident_id);
create index if not exists evaluations_analysis_id_idx on evaluations (analysis_id);
