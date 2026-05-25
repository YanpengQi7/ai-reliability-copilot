// Seed the scenarios table from src/lib/scenarios.ts
// Run: npx tsx scripts/seed-scenarios.ts
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { SCENARIOS } from "../src/lib/scenarios";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars. Put them in .env.local.");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  for (const s of SCENARIOS) {
    const { error } = await sb.from("scenarios").upsert(
      {
        slug: s.slug,
        title: s.title,
        category: s.category,
        context: s.context,
        expected_root_cause: s.expected_root_cause,
        expected_severity: s.expected_severity,
      },
      { onConflict: "slug" }
    );
    if (error) {
      console.error(`✗ ${s.slug}:`, error.message);
    } else {
      console.log(`✓ ${s.slug}`);
    }
  }
  console.log(`\nSeeded ${SCENARIOS.length} scenarios.`);
}

main();
