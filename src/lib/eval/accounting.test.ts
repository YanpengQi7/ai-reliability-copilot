import { describe, expect, it } from "vitest";
import { LedgerSchema, recoveredUsage, summarizeLedger, type LedgerEntry } from "./accounting";

const pending: LedgerEntry = { id: "1", owner: "trial", purpose: "generation", state: "reserved", reservation_usd: 0.1, usage: null, at: "2026-09-29T00:00:00.000Z" };
const known: LedgerEntry = { ...pending, id: "2", owner: "primary_trial", purpose: "judge", state: "complete", usage: { input: 10, output: 2, cost_usd: 0.02, model: "judge", purpose: "judge" } };

describe("persisted call accounting", () => {
  it("retains orphan reservations without double counting settled calls", () => {
    const result = summarizeLedger([pending, known]);
    expect(result.generation.unresolved_calls).toBe(1);
    expect(result.judge.accounted_cost_usd).toBe(0.02);
    expect(result.accounted_cost_usd).toBeCloseTo(0.12);
    expect(result.complete).toBe(false);
  });
  it("distinguishes confirmed zero cost from unknown cost", () => {
    expect(summarizeLedger([{ ...known, usage: { ...known.usage!, cost_usd: 0 } }]).accounted_cost_usd).toBe(0);
    expect(summarizeLedger([{ ...known, usage: { ...known.usage!, cost_usd: null } }]).judge.unresolved_calls).toBe(1);
  });
  it("recovers only the requested owner while preserving unknown usage", () => {
    expect(recoveredUsage([pending, known], known.owner, "fallback")).toEqual([known.usage]);
    expect(recoveredUsage([pending, known], pending.owner, "fallback")).toEqual([{ input: 0, output: 0, cost_usd: null, model: "fallback", purpose: "generation" }]);
  });
  it("rejects invalid saved costs, state, purpose and duplicate identities", () => {
    for (const entries of [
      [pending, pending], [{ ...pending, reservation_usd: -1 }],
      [{ ...pending, state: "complete" }], [{ ...known, state: "reserved" }],
      [{ ...known, purpose: "generation" }], [{ ...known, usage: { ...known.usage!, cost_usd: -1 } }],
    ]) expect(LedgerSchema.safeParse(entries).success).toBe(false);
  });
});
