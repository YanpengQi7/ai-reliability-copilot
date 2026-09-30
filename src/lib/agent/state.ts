// Investigation scratchpad.
//
// The model conversation (the `messages` array) holds the full tool transcript,
// but as it grows the model tends to re-query the same tool or lose the thread.
// The scratchpad is a compact, structured running summary we re-inject every
// round so the model always sees, at a glance: what evidence it already has,
// which (tool,input) pairs it already ran (so it doesn't repeat them), and how
// much budget remains. This is the cheap "state" layer that keeps the loop from
// spinning.

import type { TraceStep } from "./types";

function canonicalInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalInput);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalInput(item)]));
  return value;
}

export class Scratchpad {
  private evidence: string[] = [];
  private seen = new Set<string>(); // tool(input) signatures already executed
  private refusals: string[] = [];
  private failures = new Map<string, number>();

  private sig(tool: string, input: Record<string, unknown>): string {
    return `${tool}(${JSON.stringify(canonicalInput(input))})`;
  }

  // Returns true if this exact (tool,input) was already executed.
  isDuplicate(tool: string, input: Record<string, unknown>): boolean {
    const key = this.sig(tool, input);
    return this.seen.has(key) || (this.failures.get(key) ?? 0) >= 2;
  }

  record(step: TraceStep): void {
    const key = this.sig(step.tool, step.input);
    if (step.reason === "duplicate") return;
    if (step.status === "error" && step.reason !== "invalid_evidence") {
      this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
      return; // One bounded retry is allowed after a transient handler failure.
    }
    this.seen.add(key);
    if (step.status === "ok") {
      // Keep a one-line gist of each successful observation.
      const firstLine = step.observation.split("\n").find((l) => l.trim().length > 0) ?? step.observation.slice(0, 120);
      const summary = `${step.tool}: ${firstLine.slice(0, 200)}`;
      if (!this.evidence.includes(summary)) this.evidence.push(summary);
    } else if (step.status === "refused" || step.reason === "invalid_evidence") {
      this.refusals.push(`${step.tool} → ${step.reason ?? "refused"}`);
    }
  }

  // Untrusted state block passed as user context, never system instructions.
  render(opts: { stepsUsed: number; stepCap: number }): string {
    const ev = this.evidence.length
      ? this.evidence.map((e, i) => `  ${i + 1}. ${e}`).join("\n")
      : "  (none yet — call a tool to gather evidence)";
    const failures = this.failures.size ? `\nFailed reads (at most one retry for the same input):\n${[...this.failures].map(([key, count]) => `  - ${key.slice(0, 300)}: ${count} failure(s)`).join("\n")}` : "";
    const ran = this.seen.size ? [...this.seen].map((s) => `  - ${s.slice(0, 300)}`).join("\n") : "  (none)";
    const refused = this.refusals.length ? `\nRefused calls (do not retry these):\n${this.refusals.map((r) => `  - ${r}`).join("\n")}` : "";
    return `# Investigation state (step ${opts.stepsUsed}/${opts.stepCap})

Evidence gathered so far:
${ev}

Tool calls already executed (do NOT repeat the exact same call):
${ran}${refused}${failures}

When you have enough evidence to name a root cause with confidence — or you have ruled out the obvious hypotheses — STOP calling tools and reply with your final diagnosis in plain text. Do not pad the investigation.`;
  }

  evidenceCount(): number {
    return this.evidence.length;
  }
}
