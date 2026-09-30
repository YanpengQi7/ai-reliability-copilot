type Outcome = { family: string; case_id: string; success: boolean | null; reasons: string[] };

/** Planned outcomes stay in each denominator; families, not repeats, receive equal weight. */
export function summarizeFamilyQuality(rows: Outcome[]) {
  const groups = new Map<string, Outcome[]>();
  for (const row of rows) groups.set(row.family, [...(groups.get(row.family) ?? []), row]);
  const family_results = [...groups].map(([family, selected]) => {
    const succeeded = selected.filter(r => r.success === true).length;
    const failed = selected.filter(r => r.success === false);
    const unassessed = selected.filter(r => r.success === null);
    const countReasons = (outcomes: Outcome[]) => {
      const counts: Record<string, number> = {};
      for (const outcome of outcomes) for (const reason of new Set(outcome.reasons)) counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    };
    return { family, case_ids: [...new Set(selected.map(r => r.case_id))].sort(), planned: selected.length,
      assessed: selected.length - unassessed.length, succeeded, failed: failed.length, unassessed: unassessed.length,
      success_rate: succeeded / selected.length, coverage: 1 - unassessed.length / selected.length,
      failure_reasons: countReasons(failed), unassessed_reasons: countReasons(unassessed) };
  }).sort((a, b) => a.success_rate - b.success_rate || a.family.localeCompare(b.family));
  return { families: family_results.length,
    family_success_rate: family_results.length ? family_results.reduce((sum, r) => sum + r.success_rate, 0) / family_results.length : null,
    family_coverage: family_results.length ? family_results.reduce((sum, r) => sum + r.coverage, 0) / family_results.length : null,
    fully_failed_families: family_results.filter(r => r.unassessed === 0 && r.succeeded === 0).length,
    incomplete_families: family_results.filter(r => r.unassessed > 0).length,
    family_results };
}
