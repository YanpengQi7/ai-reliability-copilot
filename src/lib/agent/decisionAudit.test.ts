import { describe, expect, it } from "vitest";
import { auditDecisionHistory } from "./decisionAudit";
import type { Decision } from "./diagnosis";
const decision = (ids: string[] = [], done = false): Decision => ({ hypotheses: ids.length ? [{ hypothesis: "Cause", supporting_ids: ids, refuting_ids: [], missing: "Scope" }] : [], done, tool: "get_metrics", query: "", reason: "Verify saturation" });
const read = { tool: "get_metrics", evidence_ids: ["m1"] };
const audit = (decisions: Decision[] | undefined, reads = [read]) => auditDecisionHistory(decisions, reads, ["alert-context"], ["alert-context", "m1"]);

describe("decision history audit", () => {
  it("accepts only evidence available before each decision", () => {
    expect(audit([decision(["alert-context"]), decision(["m1"], true)]).errors).toEqual([]);
    expect(audit([decision(["m1"]), decision(["m1"], true)]).errors).toEqual([{ step: 1, reason: "unseen_reference", evidence_ids: ["m1"] }]);
  });
  it("checks contradicting citations as well as supporting citations", () => {
    const plan = decision(["alert-context"]);
    plan.hypotheses[0].refuting_ids = ["later", "later"];
    expect(audit([plan]).errors).toEqual([{ step: 1, reason: "unseen_reference", evidence_ids: ["later"] }]);
  });
  it("distinguishes unavailable historical decisions from a missing current history", () => {
    expect(audit(undefined).available).toBe(false);
    expect(audit([], []).errors).toEqual([{ step: 1, reason: "missing_decisions" }]);
  });
  it("rejects changed tool order, extra reads and decisions after stopping", () => {
    expect(audit([decision()], [{ ...read, tool: "get_logs" }]).errors[0].reason).toBe("tool_mismatch");
    expect(audit([decision([], true)]).errors[0].reason).toBe("extra_read");
    expect(audit([decision([], true), decision([], true)], []).errors[0].reason).toBe("decision_after_stop");
    expect(audit([decision()], []).errors[0].reason).toBe("missing_read");
  });
  it("does not let unrecorded returned IDs authorize later citations", () => {
    const result = audit([decision(), decision(["missing"], true)], [{ tool: "get_metrics", evidence_ids: ["missing"] }]);
    expect(result.errors.map(e => e.reason)).toEqual(["unrecorded_evidence", "unseen_reference"]);
  });
});
