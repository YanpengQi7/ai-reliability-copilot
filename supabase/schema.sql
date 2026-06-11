-- AI Reliability Copilot — DB schema
-- Run this in Supabase SQL editor (or via `supabase db push` after `supabase link`)

create extension if not exists "pgcrypto";
create extension if not exists vector;
create extension if not exists pg_trgm;

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  raw_context text not null,
  service text,
  symptoms text,
  signature text,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index if not exists incidents_signature_trgm_idx on incidents using gin (signature gin_trgm_ops);
create index if not exists incidents_embedding_hnsw_idx on incidents using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

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

-- Similar-incident RPCs (called via supabase-js .rpc(...))
create or replace function match_incidents_by_embedding(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  exclude_id uuid default null
) returns table (id uuid, title text, service text, symptoms text, similarity float, created_at timestamptz)
language sql stable as $$
  select i.id, i.title, i.service, i.symptoms,
    1 - (i.embedding <=> query_embedding) as similarity, i.created_at
  from incidents i
  where i.embedding is not null
    and (exclude_id is null or i.id <> exclude_id)
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_incidents_by_signature(
  query_text text,
  match_threshold float,
  match_count int,
  exclude_id uuid default null
) returns table (id uuid, title text, service text, symptoms text, similarity float, created_at timestamptz)
language sql stable as $$
  select i.id, i.title, i.service, i.symptoms,
    similarity(i.signature, query_text) as similarity, i.created_at
  from incidents i
  where i.signature is not null
    and (exclude_id is null or i.id <> exclude_id)
    and similarity(i.signature, query_text) > match_threshold
  order by similarity(i.signature, query_text) desc
  limit match_count;
$$;
create index if not exists analyses_incident_id_idx on analyses (incident_id);
create index if not exists evaluations_analysis_id_idx on evaluations (analysis_id);

-- Knowledge base (RAG: runbooks / postmortems / service catalog / architecture)
create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique,
  kind text not null,                  -- runbook | postmortem | service | architecture | other
  title text,
  content_hash text not null,          -- sha256 of raw_text, gates re-embedding
  raw_text text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  embedding vector(1536),
  signature text,
  token_count int,
  created_at timestamptz default now()
);
create index if not exists kb_chunks_document_id_idx on kb_chunks (document_id);
create index if not exists kb_chunks_embedding_hnsw_idx on kb_chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists kb_chunks_signature_trgm_idx on kb_chunks using gin (signature gin_trgm_ops);

-- Junction: which chunks fed which analysis (audit trail)
create table if not exists analysis_kb_chunks (
  analysis_id uuid references analyses(id) on delete cascade,
  chunk_id uuid references kb_chunks(id) on delete cascade,
  similarity float,
  rank int,
  primary key (analysis_id, chunk_id)
);
create index if not exists analysis_kb_chunks_analysis_idx on analysis_kb_chunks (analysis_id);

-- KB retrieval RPCs (see kb.ts retrieveContext())
create or replace function match_kb_chunks_by_embedding(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
) returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_kind text,
  source_path text,
  text text,
  similarity float
)
language sql stable as $$
  select c.id, c.document_id, d.title, d.kind, d.source_path, c.text,
    1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_kb_chunks_by_signature(
  query_text text,
  match_threshold float,
  match_count int
) returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_kind text,
  source_path text,
  text text,
  similarity float
)
language sql stable as $$
  select c.id, c.document_id, d.title, d.kind, d.source_path, c.text,
    similarity(c.signature, query_text) as similarity
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.signature is not null
    and similarity(c.signature, query_text) > match_threshold
  order by similarity(c.signature, query_text) desc
  limit match_count;
$$;

-- The application accesses these tables only through the server-side
-- service-role client. Keep the public Data API closed by default.
alter table incidents enable row level security;
alter table analyses enable row level security;
alter table scenarios enable row level security;
alter table evaluations enable row level security;
alter table kb_documents enable row level security;
alter table kb_chunks enable row level security;
alter table analysis_kb_chunks enable row level security;

revoke all on table incidents, analyses, scenarios, evaluations,
  kb_documents, kb_chunks, analysis_kb_chunks from anon, authenticated;
grant all on table incidents, analyses, scenarios, evaluations,
  kb_documents, kb_chunks, analysis_kb_chunks to service_role;

revoke execute on function match_incidents_by_embedding(vector, float, int, uuid)
  from public, anon, authenticated;
revoke execute on function match_incidents_by_signature(text, float, int, uuid)
  from public, anon, authenticated;
revoke execute on function match_kb_chunks_by_embedding(vector, float, int)
  from public, anon, authenticated;
revoke execute on function match_kb_chunks_by_signature(text, float, int)
  from public, anon, authenticated;

grant execute on function match_incidents_by_embedding(vector, float, int, uuid) to service_role;
grant execute on function match_incidents_by_signature(text, float, int, uuid) to service_role;
grant execute on function match_kb_chunks_by_embedding(vector, float, int) to service_role;
grant execute on function match_kb_chunks_by_signature(text, float, int) to service_role;
