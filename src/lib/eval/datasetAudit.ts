import type { EvalCase } from "./contracts";
import { hash } from "./artifacts";
import { evidenceVisibleAt } from "../agent/evidence";

/** Exact snapshot reuse only: absence of duplicates does not prove independence. */
export function auditDatasetSnapshots(cases: EvalCase[]) {
  const snapshots = new Map<string, EvalCase[]>();
  for (const c of cases) {
    // IDs, labels, row order and hidden future records do not distinguish model inputs.
    const observations = [...new Set(c.evidence.filter(e => evidenceVisibleAt(e, c.alert.at)).map(e => {
      const { id, content_hash, ...payload } = e;
      void id; void content_hash;
      return hash(payload);
    }))].sort();
    const fingerprint = hash({ alert: c.alert, observations });
    snapshots.set(fingerprint, [...(snapshots.get(fingerprint) ?? []), c]);
  }
  const duplicate_groups = [...snapshots].filter(([, group]) => group.length > 1).map(([snapshot_hash, group]) => {
    const families = [...new Set(group.map(c => c.family))].sort();
    const splits = [...new Set(group.map(c => c.split))].sort();
    return { snapshot_hash, case_ids: group.map(c => c.id).sort(), families, splits,
      cross_family: families.length > 1, cross_split: splits.length > 1 };
  }).sort((a, b) => a.snapshot_hash.localeCompare(b.snapshot_hash));
  const conflicts = duplicate_groups.filter(g => g.cross_family || g.cross_split);
  return { valid: conflicts.length === 0, unique_snapshots: snapshots.size,
    duplicate_cases: duplicate_groups.reduce((sum, g) => sum + g.case_ids.length - 1, 0),
    conflicting_groups: conflicts.length, duplicate_groups,
    scope: "Exact time-visible alert/evidence snapshots, ignoring evidence IDs, labels, order and duplicate observations. No detected conflict does not establish statistical independence or an unseen holdout." };
}
