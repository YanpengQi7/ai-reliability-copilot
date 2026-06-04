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

export class Scratchpad {
  private evidence: string[] = [];
  private seen = new Set<string>(); // tool(input) signatures already executed
  private refusals: string[] = [];

  private sig(tool: string, input: Record<string, unknown>): string {
    return `${tool}(${JSON.stringify(input)})`;
  }

  // Returns true if this exact (tool,input) was already executed.
  isDuplicate(tool: string, input: Record<string, unknown>): boolean {
    return this.seen.has(this.sig(tool, input));
  }

  record(step: TraceStep): void {
    this.seen.add(this.sig(step.tool, step.input));
    if (step.status === "ok") {
      // Keep a one-line gist of each successful observation.
      const firstLine = step.observation.split("\n").find((l) => l.trim().length > 0) ?? step.observation.slice(0, 120);
      this.evidence.push(`${step.tool}: ${firstLine}`);
    } else if (step.status === "refused") {
      this.refusals.push(`${step.tool} → ${step.reason ?? "refused"}`);
    }
  }

  // The block re-injected into the system prompt each round.
  render(opts: { stepsUsed: number; stepCap: number }): string {
    const ev = this.evidence.length
      ? this.evidence.map((e, i) => `  ${i + 1}. ${e}`).join("\n")
      : "  (none yet — call a tool to gather evidence)";
    const ran = this.seen.size ? [...this.seen].map((s) => `  - ${s}`).join("\n") : "  (none)";
    const refused = this.refusals.length ? `\nRefused calls (do not retry these):\n${this.refusals.map((r) => `  - ${r}`).join("\n")}` : "";
    return `# Investigation state (step ${opts.stepsUsed}/${opts.stepCap})

Evidence gathered so far:
${ev}

Tool calls already executed (do NOT repeat the exact same call):
${ran}${refused}

When you have enough evidence to name a root cause with confidence — or you have ruled out the obvious hypotheses — STOP calling tools and reply with your final diagnosis in plain text. Do not pad the investigation.`;
  }

  evidenceCount(): number {
    return this.evidence.length;
  }
}
