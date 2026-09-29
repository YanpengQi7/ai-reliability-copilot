"use client";

import { useState } from "react";
import type { Decision, Diagnosis } from "@/lib/agent/diagnosis";
import type { EvidenceItem } from "@/lib/agent/evidence";
import type { TraceStep } from "@/lib/agent/types";

const anchor = (id: string) => `investigation-evidence-${id}`;

export function InvestigationReview({ decisions, evidence, trace, diagnosis }: {
  decisions: Decision[]; evidence: EvidenceItem[]; trace: TraceStep[]; diagnosis: Diagnosis;
}) {
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  const knownIds = new Set(evidence.map(item => item.id));
  const refs = (ids: string[]) => ids.length ? <span className="inline-flex flex-wrap gap-2">
    {[...new Set(ids)].map(id => knownIds.has(id)
      ? <a key={id} href={`#${encodeURIComponent(anchor(id))}`} onClick={() => setSelectedEvidence(id)} className="font-mono text-xs text-indigo-300 underline">{id}</a>
      : <span key={id} className="font-mono text-xs text-red-300">{id} (unavailable)</span>)}
  </span> : <span className="text-xs text-neutral-500">None cited</span>;
  const missing = [...new Set([...diagnosis.missing_information, ...diagnosis.root_causes.flatMap(cause => cause.missing_evidence)].filter(item => item.trim()))];

  return <div className="space-y-5">
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-3 text-lg font-semibold text-white">Investigation decisions</h2>
      <p className="mb-4 text-sm text-neutral-400">Each check shows the planner’s reason and the evidence it had at that point. These are hypotheses to verify.</p>
      <ol className="space-y-3">
        {decisions.map((decision, index) => {
          const read = decision.done ? null : trace[index];
          return <li key={index} className="rounded-lg border border-neutral-800 p-3">
            <div className="text-sm font-medium text-neutral-200">{index + 1}. {decision.done ? "Planner stopped gathering evidence" : `Check: ${decision.tool}`}</div>
            <p className="mt-1 text-sm text-neutral-400">{decision.reason || "No reason recorded."}</p>
            {!decision.done && decision.query && <p className="mt-1 text-xs text-neutral-500">Query: {decision.query}</p>}
            {read && <p className="mt-2 text-xs text-neutral-400">Read result: {read.status}{read.reason ? ` (${read.reason.replaceAll("_", " ")})` : ""}</p>}
            <ul className="mt-3 space-y-3">
              {decision.hypotheses.map((hypothesis, hIndex) => <li key={hIndex} className="border-l border-neutral-700 pl-3 text-sm">
                <p className="text-neutral-200">{hypothesis.hypothesis}</p>
                <div className="mt-1 text-neutral-400">Supports: {refs(hypothesis.supporting_ids)}</div>
                <div className="mt-1 text-neutral-400">Contradicts: {refs(hypothesis.refuting_ids)}</div>
                {hypothesis.missing && <p className="mt-1 text-xs text-amber-300">Needed: {hypothesis.missing}</p>}
              </li>)}
            </ul>
          </li>;
        })}
      </ol>
      {!decisions.length && <p className="text-sm text-neutral-400">No planner decisions recorded.</p>}
    </section>

    <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <h2 className="mb-3 text-lg font-semibold text-white">Unresolved evidence</h2>
      {missing.length ? <ul className="list-disc space-y-2 pl-5 text-sm text-amber-200">{missing.map(item => <li key={item}>{item}</li>)}</ul>
        : <p className="text-sm text-neutral-400">No missing evidence stated in the diagnosis.</p>}
      {diagnosis.root_causes.some(cause => cause.next_check.trim()) && <div className="mt-4 space-y-2">
        <h3 className="text-sm font-medium text-neutral-200">Checks that would distinguish causes</h3>
        {diagnosis.root_causes.filter(cause => cause.next_check.trim()).map((cause, index) => <p key={index} className="text-sm text-neutral-400">{cause.hypothesis}: {cause.next_check}</p>)}
      </div>}
    </section>

    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-3 text-lg font-semibold text-white">Evidence records</h2>
      <p className="mb-3 text-xs text-neutral-500">Source metadata is supplied by the evidence adapter. User and alert reports are unverified context.</p>
      <ul className="space-y-2">
        {evidence.map(item => {
          const open = selectedEvidence === item.id;
          return <li key={item.id} id={anchor(item.id)} className="scroll-mt-6 rounded-lg border border-neutral-800 p-3">
            <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open} aria-controls={`${anchor(item.id)}-details`} onClick={() => setSelectedEvidence(open ? null : item.id)}>
              <span className="font-mono text-sm text-indigo-300">{item.id}</span>
              <span className="text-xs text-neutral-500">{item.kind} · {item.service}</span>
              <span className="ml-auto text-xs text-neutral-500">{open ? "Hide" : "Inspect"}</span>
            </button>
            <div id={`${anchor(item.id)}-details`} hidden={!open} className="mt-3 space-y-2">
              <dl className="grid gap-1 text-xs text-neutral-400">
                <div><dt className="inline text-neutral-500">Source: </dt><dd className="inline">{item.source}</dd></div>
                <div><dt className="inline text-neutral-500">Observed: </dt><dd className="inline">{item.observed_at}</dd></div>
                <div><dt className="inline text-neutral-500">Available: </dt><dd className="inline">{item.available_at}</dd></div>
                {item.measurement && <div><dt className="inline text-neutral-500">Measurement: </dt><dd className="inline">{item.measurement.metric}: {item.measurement.value} {item.measurement.unit}, window {item.measurement.window}</dd></div>}
              </dl>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 text-xs text-neutral-300">{item.text}</pre>
            </div>
          </li>;
        })}
      </ul>
    </section>
  </div>;
}
