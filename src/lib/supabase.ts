import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy init — see comment in src/lib/ai.ts for full rationale.
// tsx scripts hoist ES-module imports before `dotenv.config()` runs, so reading
// process.env at module top-level captures empty values. Read inside the
// factory functions instead.

let _browser: SupabaseClient | null | undefined;
function getBrowser(): SupabaseClient | null {
  if (_browser !== undefined) return _browser;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _browser = url && anonKey ? createClient(url, anonKey) : null;
  return _browser;
}

// `supabase` retains its original shape (browser client, possibly null)
// but defers actual creation. Proxy-free implementation: a getter property
// would also work, but a plain object with lazy access via the function below
// is most idiomatic. For now most call sites can just call `getBrowser()` —
// we keep the export name `supabase` for back-compat.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const client = getBrowser();
    if (!client) throw new Error("Browser Supabase client not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing)");
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

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
