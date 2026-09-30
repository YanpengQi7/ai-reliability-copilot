import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
vi.mock("@/lib/ai", () => ({ resolveModel: vi.fn() }));
import { resolveModel } from "../ai";
import { Budget, BudgetExceeded, liveModel } from "./provider";
import { recoveredUsage, summarizeLedger, type LedgerEntry } from "./accounting";
import { ManifestSchema, type CallUsage } from "./contracts";
import { hash } from "./artifacts";
import { loadDataset } from "./dataset";
import { buildReport } from "./report";
import { plannedTrials } from "./engine";
import { INVESTIGATION_ENGINE_VERSION } from "../agent/runtime";

const cases = loadDataset("evals/datasets/sre-v2/cases.json").slice(0, 1);
const manifest = ManifestSchema.parse({ version: "eval-v2", engine_version: INVESTIGATION_ENGINE_VERSION, id: "provider-accounting", created_at: "now", git_sha: "sha", dirty: false, source_hash: "source", dataset_hash: hash(cases), prompt_hash: "prompt", schema_hash: "schema", rubric_hash: "rubric", policy_version: "impact-v2", model: "fixture-generator", judge_model: "fixture-judge", modes: ["full"], languages: ["en"], repeats: 1, seed: 1, budget: { max_usd: 1, per_call_usd: 1, max_calls: 20, max_minutes: 10, max_output_tokens: 100, input_per_million: 2, output_per_million: 4, judge_input_per_million: 3, judge_output_per_million: 5 }, case_ids: cases.map(c => c.id), protocol: { min_families: 2, noninferiority_margin: 0.05, max_cost_ratio: 2 } });
const schema = z.object({ answer: z.string() });
const response = { id: "fixture-request", timestamp: new Date("2026-09-30T00:00:00.000Z"), modelId: "fixture-model" };
function provider(text: string, counts: [number | undefined, number | undefined] = [10, 20], finish: "stop" | "length" = "stop") {
  const [input, output] = counts;
  return new MockLanguageModelV3({ doGenerate: { content: [{ type: "text", text }], finishReason: { unified: finish, raw: finish },
    usage: { inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: output, text: output, reasoning: undefined } }, response, warnings: [] } });
}
function setup(model: MockLanguageModelV3, config = manifest.budget) {
  vi.mocked(resolveModel).mockReturnValue(model);
  const ledger: LedgerEntry[] = [], saved: LedgerEntry[][] = [], calls: CallUsage[] = [];
  const budget = new Budget(config, ledger, () => saved.push(structuredClone(ledger)));
  return { ledger, saved, calls, budget, client: liveModel({ ...manifest, budget: config }, "trial", budget, usage => calls.push(usage)) };
}

describe("live provider accounting through the installed SDK", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["Private malformed output", '{"answer":42,"private":"Rejected schema output"}'])("retains paid usage when structured output fails: %s", async text => {
    const model = provider(text), { client, ledger, saved, calls } = setup(model);
    await expect(client.call(schema, "System", "Prompt", "generation")).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(saved[0][0]).toMatchObject({ state: "reserved", usage: null });
    expect(saved.at(-1)?.[0]).toMatchObject({ state: "complete", usage: { input: 10, output: 20, model: manifest.model, purpose: "generation", request_id: response.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0].cost_usd).toBeCloseTo(0.0001);
    expect(summarizeLedger(ledger)).toMatchObject({ complete: true, generation: { unresolved_calls: 0 } });
    expect(recoveredUsage(ledger, "trial", manifest.model)).toEqual(calls);
    expect(JSON.stringify({ saved, calls })).not.toContain(text);
    const trial = { ...plannedTrials(manifest, cases)[0], status: "failed" as const, calls, failure: "Structured output rejected" };
    const report = buildReport(manifest, cases, [trial], [], ledger);
    expect(report.modes.full).toMatchObject({ assessed: 1, succeeded: 0, cost_complete: true });
    expect(report.modes.full.known_cost_usd).toBeCloseTo(0.0001);
  });
  it("uses judge prices and preserves schema errors without retrying", async () => {
    const model = provider("not JSON"), { client, calls, ledger } = setup(model);
    await expect(client.call(schema, "System", "Prompt", "judge")).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(calls[0]).toMatchObject({ purpose: "judge", model: manifest.judge_model });
    expect(calls[0].cost_usd).toBeCloseTo(0.00013);
    expect(summarizeLedger(ledger).judge.calls).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it.each([[10, undefined], [undefined, 20], [undefined, undefined], [-1, 20], [10, NaN]])("keeps incomplete or invalid usage unresolved (%s, %s)", async (input, output) => {
    const model = provider("not JSON", [input, output]), { client, calls, ledger } = setup(model);
    await expect(client.call(schema, "System", "Prompt", "generation")).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(calls[0].cost_usd).toBeNull();
    expect(summarizeLedger(ledger).complete).toBe(false);
    expect(summarizeLedger(ledger).generation.accounted_cost_usd).toBe(ledger[0].reservation_usd);
  });
  it("keeps transport failures unknown and does not trust arbitrary error usage fields", async () => {
    const failure = Object.assign(new Error("transport unavailable"), { usage: { inputTokens: 0, outputTokens: 0 } });
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw failure; } });
    const { client, ledger, calls } = setup(model);
    await expect(client.call(schema, "System", "Prompt", "generation")).rejects.toBe(failure);
    expect(ledger[0]).toMatchObject({ state: "unknown", usage: null });
    expect(calls).toEqual([{ input: 0, output: 0, cost_usd: null, model: manifest.model, purpose: "generation" }]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("settles successful output once and preserves explicitly reported zero usage", async () => {
    const model = provider('{"answer":"ok"}', [0, 0]), { client, calls, ledger } = setup(model);
    expect(await client.call(schema, "System", "Prompt", "generation")).toEqual({ answer: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].cost_usd).toBe(0);
    expect(summarizeLedger(ledger)).toMatchObject({ complete: true, accounted_cost_usd: 0 });
  });
  it("retains usage when token exhaustion prevents a structured result", async () => {
    const model = provider('{"answer":"unfinished', [10, 20], "length"), { client, calls, ledger } = setup(model);
    await expect(client.call(schema, "System", "Prompt", "generation")).rejects.toBeInstanceOf(NoOutputGeneratedError);
    expect(calls).toHaveLength(1);
    expect(calls[0].cost_usd).toBeCloseTo(0.0001);
    expect(summarizeLedger(ledger).complete).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("applies failed-response spending to a resumed run's budget", async () => {
    const model = provider("not JSON", [10_000, 20_000]), { client, ledger, calls } = setup(model, { ...manifest.budget, max_usd: 0.08 });
    await expect(client.call(schema, "System", "Prompt", "generation")).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(calls[0].cost_usd).toBeCloseTo(0.1);
    const resumed = new Budget({ ...manifest.budget, max_usd: 0.08 }, ledger, () => {});
    expect(() => resumed.reserve("next-trial", "generation", 0.001)).toThrow(BudgetExceeded);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
