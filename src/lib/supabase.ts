import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy init — see comment in src/lib/ai.ts for full rationale.
// tsx scripts hoist ES-module imports before `dotenv.config()` runs, so reading
// process.env at module top-level captures empty values. Read inside the
// factory functions instead.

let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase env vars missing (URL or SERVICE_ROLE_KEY)");
  }
  _admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _admin;
}
