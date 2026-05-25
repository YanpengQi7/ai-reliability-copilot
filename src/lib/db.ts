import { supabaseAdmin } from "./supabase";

export type IncidentRow = {
  id: string;
  title: string | null;
  service: string | null;
  symptoms: string | null;
  raw_context: string;
  created_at: string;
};

export type AnalysisRow = {
  id: string;
  incident_id: string;
  model: string | null;
  prompt_version: string | null;
  summary: string | null;
  severity: string | null;
  severity_reasoning?: string | null;
  root_causes: unknown;
  investigation_checklist: unknown;
  mitigation_plan: unknown;
  customer_impact: string | null;
  postmortem_draft: string | null;
  follow_ups: unknown;
  latency_ms: number | null;
  created_at: string;
};

export function hasSupabase() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function listIncidents(limit = 50): Promise<IncidentRow[]> {
  if (!hasSupabase()) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as IncidentRow[];
}

export async function getIncidentWithAnalyses(id: string) {
  if (!hasSupabase()) return null;
  const sb = supabaseAdmin();
  const { data: incident, error: e1 } = await sb.from("incidents").select("*").eq("id", id).single();
  if (e1) return null;
  const { data: analyses, error: e2 } = await sb
    .from("analyses")
    .select("*")
    .eq("incident_id", id)
    .order("created_at", { ascending: false });
  if (e2) throw e2;
  return { incident: incident as IncidentRow, analyses: (analyses ?? []) as AnalysisRow[] };
}
