import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Browser / RLS-respecting client
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

// Server-only client that bypasses RLS. Never import in client components.
export function supabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error("Supabase env vars missing (URL or SERVICE_ROLE_KEY)");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
