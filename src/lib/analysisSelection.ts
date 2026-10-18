type AnalysisSearch = {
  analysis?: string | string[];
  compare?: string | string[];
};

/** Resolve only records already loaded for this incident; query IDs never fetch other records. */
export function resolveAnalysisSelection<T extends { id: string }>(
  analyses: T[],
  search: AnalysisSearch,
): { selected?: T; baseline?: T; invalidSelection: boolean } {
  const requested = typeof search.analysis === "string" ? search.analysis : undefined;
  const comparison = typeof search.compare === "string" ? search.compare : undefined;
  const selected = analyses.find((analysis) => analysis.id === requested) ?? analyses[0];
  const candidate = analyses.find((analysis) => analysis.id === comparison);
  const baseline = candidate?.id === selected?.id ? undefined : candidate;
  const invalidSelection = Boolean(
    (search.analysis !== undefined && (!requested || !analyses.some((analysis) => analysis.id === requested))) ||
    (search.compare !== undefined && search.compare !== "" && (!comparison || !candidate)),
  );
  return { selected, baseline, invalidSelection };
}
