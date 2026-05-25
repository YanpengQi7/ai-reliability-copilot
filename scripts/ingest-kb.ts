// Ingest a directory of markdown files into the knowledge base.
// Usage:
//   npm run kb:ingest              # uses ./sample-kb
//   npm run kb:ingest -- ./docs    # custom dir
//   npm run kb:ingest -- ./docs --kind=runbook   # force a kind for all files
//
// Kind detection (when not forced):
//   filename matches /postmortem/i  → postmortem
//   filename matches /runbook/i     → runbook
//   filename matches /service|catalog|arch/i → service / architecture
//   else → other

import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import { resolve, join, basename } from "node:path";
import { ingestDocument, type KbKind } from "../src/lib/kb";
import { hasEmbeddingProvider } from "../src/lib/embeddings";

function detectKind(filename: string): KbKind {
  const n = filename.toLowerCase();
  if (/postmortem|incident-report/.test(n)) return "postmortem";
  if (/runbook|playbook/.test(n)) return "runbook";
  if (/architecture|arch[-_]/.test(n)) return "architecture";
  if (/service|catalog/.test(n)) return "service";
  return "other";
}

function extractTitle(text: string): string | undefined {
  const m = text.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim();
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMarkdown(p)));
    else if (/\.(md|mdx|markdown)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => !a.startsWith("--")) ?? "./sample-kb";
  const forcedKindArg = args.find((a) => a.startsWith("--kind="));
  const forcedKind = forcedKindArg?.split("=")[1] as KbKind | undefined;

  const root = resolve(dirArg);
  console.log(`source dir: ${root}`);
  console.log(`embedding provider: ${hasEmbeddingProvider() ? "OpenAI (semantic mode)" : "none (trigram-only mode — set OPENAI_API_KEY for semantic search)"}`);

  let files: string[];
  try {
    files = await walkMarkdown(root);
  } catch (e) {
    console.error(`failed to read ${root}:`, e instanceof Error ? e.message : e);
    process.exit(1);
  }
  console.log(`found ${files.length} markdown files`);

  let ingested = 0, skipped = 0, failed = 0, chunks = 0;
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    const raw_text = await fs.readFile(file, "utf8");
    const kind = forcedKind ?? detectKind(basename(file));
    const title = extractTitle(raw_text);
    try {
      const r = await ingestDocument({ source_path: rel, kind, title, raw_text });
      if (r.skipped) {
        skipped++;
        console.log(`  ⏭  ${rel} (unchanged)`);
      } else {
        ingested++;
        chunks += r.chunks_written;
        console.log(`  ✓  ${rel} (${kind}, ${r.chunks_written} chunks)`);
      }
    } catch (e) {
      failed++;
      console.error(`  ✗  ${rel}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\ndone: ${ingested} ingested · ${skipped} unchanged · ${failed} failed · ${chunks} chunks written`);
}

main();
