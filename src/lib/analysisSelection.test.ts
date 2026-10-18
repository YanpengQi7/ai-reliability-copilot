import { describe, expect, it } from "vitest";
import { resolveAnalysisSelection } from "./analysisSelection";

const latest = { id: "latest", summary: "Current diagnosis" };
const earlier = { id: "earlier", summary: "Earlier diagnosis" };
const oldest = { id: "oldest", summary: "Original diagnosis" };
const analyses = [latest, earlier, oldest];

describe("resolveAnalysisSelection", () => {
  it("opens the latest analysis when no version is requested", () => {
    expect(resolveAnalysisSelection(analyses, {})).toEqual({
      selected: latest,
      baseline: undefined,
      invalidSelection: false,
    });
  });

  it("opens an earlier analysis and its chosen comparison from the same incident", () => {
    const result = resolveAnalysisSelection(analyses, { analysis: "earlier", compare: "oldest" });
    expect(result).toEqual({ selected: earlier, baseline: oldest, invalidSelection: false });
    expect(result.selected).toBe(earlier);
    expect(result.baseline).toBe(oldest);
  });

  it("allows comparing an earlier run with the latest run", () => {
    expect(resolveAnalysisSelection(analyses, { analysis: "oldest", compare: "latest" })).toEqual({
      selected: oldest,
      baseline: latest,
      invalidSelection: false,
    });
  });

  it("uses the latest run as the selection when only a comparison is requested", () => {
    expect(resolveAnalysisSelection(analyses, { compare: "earlier" })).toEqual({
      selected: latest,
      baseline: earlier,
      invalidSelection: false,
    });
  });

  it.each(["unknown", "analysis-from-another-incident", "", " earlier"])(
    "falls back to the latest run with a warning for invalid selection %j",
    (analysis) => {
      expect(resolveAnalysisSelection(analyses, { analysis })).toEqual({
        selected: latest,
        baseline: undefined,
        invalidSelection: true,
      });
    },
  );

  it.each(["unknown", "analysis-from-another-incident", " oldest"])(
    "suppresses invalid comparison %j without changing the chosen run",
    (compare) => {
      expect(resolveAnalysisSelection(analyses, { analysis: "earlier", compare })).toEqual({
        selected: earlier,
        baseline: undefined,
        invalidSelection: true,
      });
    },
  );

  it("keeps a valid comparison when the requested selected run is unavailable", () => {
    expect(resolveAnalysisSelection(analyses, { analysis: "missing", compare: "oldest" })).toEqual({
      selected: latest,
      baseline: oldest,
      invalidSelection: true,
    });
  });

  it.each([["earlier", "oldest"], ["earlier"], []])(
    "rejects ambiguous or malformed selected query arrays %j",
    (...analysis) => {
      expect(resolveAnalysisSelection(analyses, { analysis })).toEqual({
        selected: latest,
        baseline: undefined,
        invalidSelection: true,
      });
    },
  );

  it.each([["oldest", "latest"], ["oldest"], []])(
    "rejects ambiguous or malformed comparison query arrays %j",
    (...compare) => {
      expect(resolveAnalysisSelection(analyses, { analysis: "earlier", compare })).toEqual({
        selected: earlier,
        baseline: undefined,
        invalidSelection: true,
      });
    },
  );

  it("treats an empty comparison as no comparison", () => {
    expect(resolveAnalysisSelection(analyses, { analysis: "earlier", compare: "" })).toEqual({
      selected: earlier,
      baseline: undefined,
      invalidSelection: false,
    });
  });

  it.each([{ analysis: "earlier", compare: "earlier" }, { compare: "latest" }])(
    "suppresses comparing a run with itself for %j",
    (search) => {
      const result = resolveAnalysisSelection(analyses, search);
      expect(result.baseline).toBeUndefined();
      expect(result.invalidSelection).toBe(false);
      expect(result.selected).toBe(search.analysis ? earlier : latest);
    },
  );

  it("returns an empty valid selection for an incident with no analyses", () => {
    expect(resolveAnalysisSelection([], {})).toEqual({
      selected: undefined,
      baseline: undefined,
      invalidSelection: false,
    });
  });

  it("warns when a query requests records from an incident with no analyses", () => {
    expect(resolveAnalysisSelection([], { analysis: "latest", compare: "earlier" })).toEqual({
      selected: undefined,
      baseline: undefined,
      invalidSelection: true,
    });
  });

  it("does not reorder or alter the incident's loaded analyses", () => {
    const frozen = Object.freeze([Object.freeze(latest), Object.freeze(earlier)]);
    expect(resolveAnalysisSelection(frozen as unknown as typeof analyses, { analysis: "earlier", compare: "latest" })).toEqual({
      selected: earlier,
      baseline: latest,
      invalidSelection: false,
    });
    expect(frozen).toEqual([latest, earlier]);
  });
});
