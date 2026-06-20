import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_VERSION } from "./prompts";
import { parseAnalysisOptions } from "./analysisOptions";

describe("parseAnalysisOptions", () => {
  it("uses maintained defaults when options are omitted", () => {
    expect(parseAnalysisOptions(new URLSearchParams())).toEqual({
      ok: true,
      version: DEFAULT_PROMPT_VERSION,
      language: "en",
    });
  });

  it("accepts every supported explicit option", () => {
    expect(parseAnalysisOptions(new URLSearchParams("version=v1&language=zh"))).toEqual({
      ok: true,
      version: "v1",
      language: "zh",
    });
  });

  it.each(["v4", "V3", "", " v2"])("rejects invalid version %j", (version) => {
    const result = parseAnalysisOptions(new URLSearchParams({ version }));
    expect(result).toMatchObject({ ok: false });
  });

  it.each(["cn", "EN", "", " zh"])("rejects invalid language %j", (language) => {
    const result = parseAnalysisOptions(new URLSearchParams({ language }));
    expect(result).toMatchObject({ ok: false });
  });
});
