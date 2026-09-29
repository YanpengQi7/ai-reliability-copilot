import { z } from "zod";
import { UsageSchema, type CallUsage } from "./contracts";

export const LedgerEntrySchema = z.object({
  id: z.string().min(1), owner: z.string().min(1),
  purpose: z.enum(["generation", "judge"]),
  state: z.enum(["reserved", "complete", "unknown"]),
  reservation_usd: z.number().finite().nonnegative(),
  usage: UsageSchema.nullable(), at: z.string().datetime(), elapsed_ms: z.number().finite().nonnegative().optional(),
}).refine(e => e.state !== "reserved" || e.usage === null, "Reserved calls cannot contain settled usage")
  .refine(e => e.state !== "complete" || e.usage !== null, "Complete calls require usage")
  .refine(e => !e.usage || e.usage.purpose === e.purpose, "Ledger purpose differs from usage");
export const LedgerSchema = z.array(LedgerEntrySchema).refine(entries => new Set(entries.map(e => e.id)).size === entries.length, "Duplicate ledger entry IDs");
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export function recoveredUsage(entries: LedgerEntry[], owner: string, model: string): CallUsage[] {
  return entries.filter(e => e.owner === owner).map(e => e.usage ?? { input: 0, output: 0, cost_usd: null, model, purpose: e.purpose });
}

/** Unknown calls retain their reservation; neither zero nor an invoice claim. */
export function summarizeLedger(raw: LedgerEntry[]) {
  const entries = LedgerSchema.parse(raw);
  const group = (purpose: LedgerEntry["purpose"]) => {
    const selected = entries.filter(e => e.purpose === purpose);
    const unresolved = selected.filter(e => e.usage?.cost_usd == null);
    const known = selected.reduce((sum, e) => sum + (e.usage?.cost_usd ?? 0), 0);
    const reserved = unresolved.reduce((sum, e) => sum + e.reservation_usd, 0);
    return { calls: selected.length, known_cost_usd: known, unresolved_calls: unresolved.length,
      unresolved_reservations_usd: reserved, accounted_cost_usd: known + reserved };
  };
  const generation = group("generation"), judge = group("judge");
  return { generation, judge, complete: generation.unresolved_calls + judge.unresolved_calls === 0,
    accounted_cost_usd: generation.accounted_cost_usd + judge.accounted_cost_usd,
    scope: "All calls in this run, including calibration and every judge-run. Unknown usage retains reservations; amounts are estimates, not provider invoices." };
}
