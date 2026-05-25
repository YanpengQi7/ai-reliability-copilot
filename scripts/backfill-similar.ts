// Backfill signature + embedding for existing incidents that were created
// before the similarity-search feature shipped.
// Run: npm run backfill:similar

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { embed, buildSignature, hasEmbeddingProvider } from "../src/lib/embeddings";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log("embedding provider:", hasEmbeddingProvider() ? "OpenAI (semantic search will work)" : "none (trigram-only mode)");

  // Get incidents missing signature
  const { data: incidents, error } = await sb
    .from("incidents")
    .select("id, title, service, symptoms, signature, embedding")
    .or("signature.is.null,embedding.is.null");
  if (error) { console.error("query failed:", error.message); process.exit(1); }

  console.log(`found ${incidents?.length ?? 0} incidents needing backfill`);

  let updated = 0;
  for (const inc of incidents ?? []) {
    // For backfill we use the latest analysis summary if available
    const { data: analyses } = await sb
      .from("analyses")
      .select("summary, severity")
      .eq("incident_id", inc.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const a = analyses?.[0];

    const signature = buildSignature({
      title: inc.title,
      service: inc.service,
      symptoms: inc.symptoms,
      summary: a?.summary ?? null,
      severity: a?.severity ?? null,
    });
    const embedding = inc.embedding ? null : await embed(signature);

    const update: Record<string, unknown> = {};
    if (!inc.signature) update.signature = signature;
    if (embedding) update.embedding = embedding;

    if (Object.keys(update).length === 0) { continue; }

    const { error: ue } = await sb.from("incidents").update(update).eq("id", inc.id);
    if (ue) {
      console.error(`  ✗ ${inc.id}: ${ue.message}`);
    } else {
      updated++;
      process.stdout.write(".");
    }
  }
  console.log(`\nbackfilled ${updated} rows`);
}

main();
