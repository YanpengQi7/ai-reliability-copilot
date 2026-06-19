import { describe, expect, it } from "vitest";
import { buildIncidentRecord } from "./incidentRecord";

describe("buildIncidentRecord", () => {
  it("maps incident fields and preserves the vector payload", () => {
    const embedding = [0.1, 0.2];
    expect(buildIncidentRecord({
      title: "Checkout degraded",
      service: "checkout",
      symptoms: "Elevated latency",
      rawContext: "p99 latency exceeded the alert threshold",
      signature: "checkout · elevated latency",
      embedding,
    })).toEqual({
      title: "Checkout degraded",
      service: "checkout",
      symptoms: "Elevated latency",
      raw_context: "p99 latency exceeded the alert threshold",
      signature: "checkout · elevated latency",
      embedding,
    });
  });

  it("normalizes optional database fields to null", () => {
    expect(buildIncidentRecord({ rawContext: "raw incident context" })).toEqual({
      title: null,
      service: null,
      symptoms: null,
      raw_context: "raw incident context",
      signature: null,
      embedding: null,
    });
  });
});
