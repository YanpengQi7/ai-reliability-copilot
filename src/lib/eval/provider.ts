import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "../ai";
import type { Manifest, CallUsage } from "./contracts";
import type { EvalModel } from "./engine";

export type LedgerEntry = { id: string; owner: string; purpose: "generation" | "judge"; state: "reserved" | "complete" | "unknown"; reservation_usd: number; usage: CallUsage | null; at: string; elapsed_ms?: number };
export class BudgetExceeded extends Error {}

/** Persist reservations BEFORE calling a provider, so interruption cannot erase spending. */
export class Budget {
  private started = Date.now();
  private priorElapsed: number;
  constructor(readonly config: Manifest["budget"], readonly ledger: LedgerEntry[], private readonly save: () => void) {
    this.priorElapsed = ledger.reduce((s, e) => s + (e.elapsed_ms ?? 120_000), 0);
  }
  reserve(owner: string, purpose: LedgerEntry["purpose"], amount: number) {
    const spent = this.ledger.reduce((s, e) => s + (e.usage?.cost_usd ?? e.reservation_usd), 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > this.config.per_call_usd || spent + amount > this.config.max_usd || this.ledger.length >= this.config.max_calls || this.remainingTime() <= 0) throw new BudgetExceeded("Run budget exhausted or call exceeds reservation cap");
    const entry: LedgerEntry = { id: String(this.ledger.length + 1), owner, purpose, state: "reserved", reservation_usd: amount, usage: null, at: new Date().toISOString() };
    this.ledger.push(entry); this.save(); return entry;
  }
  settle(entry: LedgerEntry, usage: CallUsage | null) { entry.state = usage ? "complete" : "unknown"; entry.usage = usage; entry.elapsed_ms = Date.now() - Date.parse(entry.at); this.save(); }
  remainingTime() { return Math.max(0, this.config.max_minutes * 60_000 - this.priorElapsed - (Date.now() - this.started)); }
}

export function liveModel(manifest: Manifest, owner: string, budget: Budget, onUsage: (usage: CallUsage) => void): EvalModel {
  return {
    async call<T>(schema: z.ZodType<T>, system: string, prompt: string, purpose: "generation" | "judge"): Promise<T> {
      const modelId = purpose === "judge" ? manifest.judge_model : manifest.model;
      const b = manifest.budget;
      const inputPrice = purpose === "judge" ? b.judge_input_per_million : b.input_per_million;
      const outputPrice = purpose === "judge" ? b.judge_output_per_million : b.output_per_million;
      // UTF-8 bytes + schema + framing is conservative for text tokenization.
      // Prices are explicit run inputs; these are estimates, not provider invoices.
      const inputBound = Buffer.byteLength(system + prompt + JSON.stringify(z.toJSONSchema(schema))) + 4096;
      const reserve = (inputBound * inputPrice + b.max_output_tokens * outputPrice) / 1_000_000;
      const entry = budget.reserve(owner, purpose, reserve);
      let usage: CallUsage | null = null;
      try {
        const result = await generateText({ model: resolveModel(modelId), output: Output.object({ schema }), system, prompt, ...(manifest.thinking === "disabled" && (modelId.startsWith("deepseek:") || !modelId.includes(":")) ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } } : {}), temperature: 0, maxRetries: 0, maxOutputTokens: b.max_output_tokens, abortSignal: AbortSignal.timeout(Math.min(120_000, budget.remainingTime())) });
        usage = { input: result.totalUsage.inputTokens ?? 0, output: result.totalUsage.outputTokens ?? 0, cost_usd: result.totalUsage.inputTokens === undefined || result.totalUsage.outputTokens === undefined ? null : ((result.totalUsage.inputTokens * inputPrice) + (result.totalUsage.outputTokens * outputPrice)) / 1_000_000, model: modelId, purpose, request_id: result.response.id };
        return schema.parse(result.output);
      } finally {
        budget.settle(entry, usage);
        onUsage(usage ?? { input: 0, output: 0, cost_usd: null, model: modelId, purpose });
      }
    },
  };
}
