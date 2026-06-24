import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis } from "@/lib/schema";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  deepseek: vi.fn((modelId: string) => ({ provider: "deepseek", modelId })),
}));

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateObject: mocks.generateObject,
}));

vi.mock("@/lib/ai", () => ({
  deepseek: mocks.deepseek,
  JUDGE_MODEL: "judge-test-model",
  JUDGE_MODEL_GROUNDING: "judge-grounding-test-model",
}));

import { generateObject } from "ai";
import { judge, judgeWithGrounding } from "./judge";

const mockedGenerateObject = vi.mocked(generateObject);

function analysis(): Analysis {
  return {
    summary: "payment-svc latency increased after a deploy.",
    severity: "SEV2",
    severity_reasoning: "Checkout is degraded for a subset of users.",
    root_causes: [
      { hypothesis: "DB pool exhaustion", evidence: "connection pool saturated", likelihood: "high" },
      { hypothesis: "Slow query regression", evidence: "p99 query latency increased", likelihood: "medium" },
      { hypothesis: "Traffic spike", evidence: "request volume increased", likelihood: "low" },
    ],
    investigation_checklist: [
      { step: "Check DB pool", command: "kubectl logs deploy/payment-svc | grep pool", expected: "pool exhaustion errors" },
      { step: "Check deploy", command: "kubectl rollout history deploy/payment-svc", expected: "recent rollout" },
      { step: "Check p99", command: "curl metrics/payment-svc/p99", expected: "latency above baseline" },
    ],
    mitigation_plan: [
      { action: "Scale DB pool safely", risk: "can overload database", rollback: "restore prior pool size" },
      { action: "Rollback payment-svc", risk: "may revert safe fixes", rollback: "roll forward fixed build" },
    ],
    customer_impact: "Some checkout requests are slow or fail.",
    postmortem_draft: "## Summary\n...\n## Timeline\n...",
    follow_ups: [
      { item: "Add pool saturation alert", owner_role: "platform team", priority: "P1" },
      { item: "Load test checkout", owner_role: "service owner", priority: "P1" },
      { item: "Document rollback", owner_role: "on-call SRE", priority: "P2" },
    ],
  };
}

const scores = {
  specificity: { score: 4, reasoning: "specific service cited" },
  safety: { score: 4, reasoning: "rollback included" },
  actionability: { score: 4, reasoning: "commands included" },
  domain_correctness: { score: 4, reasoning: "root cause plausible" },
  completeness: { score: 4, reasoning: "sections filled" },
  overall_notes: "solid",
};

describe("judge cancellation", () => {
  beforeEach(() => {
    mockedGenerateObject.mockReset();
    mocks.deepseek.mockClear();
  });

  it("does not call the judge model when already cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("request cancelled");
    controller.abort(cancellation);

    await expect(judge({ analysis: analysis() }, undefined, { abortSignal: controller.signal }))
      .rejects.toBe(cancellation);

    expect(mockedGenerateObject).not.toHaveBeenCalled();
  });

  it("does not return grounding scores after cancellation races the model response", async () => {
    const controller = new AbortController();
    const cancellation = new Error("request cancelled");
    mockedGenerateObject.mockImplementationOnce(async () => {
      controller.abort(cancellation);
      return { object: { ...scores, evidence_grounding: { score: 4, reasoning: "trace cited" } } } as never;
    });

    await expect(judgeWithGrounding(
      { analysis: analysis(), trace: "get_metrics returned pool saturation" },
      undefined,
      { abortSignal: controller.signal },
    )).rejects.toBe(cancellation);

    expect(mockedGenerateObject).toHaveBeenCalledOnce();
  });
});
