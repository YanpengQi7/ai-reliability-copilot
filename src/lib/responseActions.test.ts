import { describe, expect, it } from "vitest";
import {
  RESPONSE_LIMITS, buildResponseActions, getActionProgress, sanitizeResponseProgress,
  summarizeResponseProgress, buildResponseHandoffMarkdown, buildResponseHandoffJson,
  type ResponseProgress,
} from "./responseActions";

const source = {
  id: "analysis-2", incident_id: "incident-1", model: "deepseek-chat", prompt_version: "v3",
  output_language: "en", created_at: "2026-10-04T15:00:00Z",
  summary: "Checkout fails after the deploy.", severity: "SEV2", severity_reasoning: "A subset of checkouts fail.",
  investigation_checklist: [
    { step: "Inspect pool", command: "kubectl logs deploy/checkout", expected: "Connection acquisition timeout" },
    { step: "Inspect provider", command: "curl -I https://status.example.com", expected: "Provider is responding" },
  ],
  mitigation_plan: [{ action: "Roll back", risk: "Recent fixes are removed", rollback: "Redeploy the current version" }],
  follow_ups: [{ item: "Load test limits", owner_role: "Service owner", priority: "P1" }],
};
const actions = buildResponseActions(source);
const context = { id: "incident-1", title: "Checkout incident", service: "checkout", symptoms: "SYMPTOMS_MUST_NOT_EXPORT", raw_context: "RAW_LOGS_MUST_NOT_EXPORT" };
const progress: ResponseProgress = {
  "investigation:0": { status: "done", owner: "Alice", outcome: "Observed 80 pending connections." },
  "investigation:1": { status: "in_progress", owner: "Bob", outcome: "Waiting for probe results." },
  "mitigation:0": { status: "blocked", owner: "On-call", outcome: "Waiting for deploy access." },
};

describe("buildResponseActions", () => {
  it("preserves source action fields and order across all three categories", () => {
    expect(actions).toEqual([
      { id: "investigation:0", category: "investigation", title: "Inspect pool", command: "kubectl logs deploy/checkout", expected: "Connection acquisition timeout", risk: "", rollback: "", suggestedOwner: "", priority: "" },
      { id: "investigation:1", category: "investigation", title: "Inspect provider", command: "curl -I https://status.example.com", expected: "Provider is responding", risk: "", rollback: "", suggestedOwner: "", priority: "" },
      { id: "mitigation:0", category: "mitigation", title: "Roll back", command: "", expected: "", risk: "Recent fixes are removed", rollback: "Redeploy the current version", suggestedOwner: "", priority: "" },
      { id: "follow_up:0", category: "follow_up", title: "Load test limits", command: "", expected: "", risk: "", rollback: "", suggestedOwner: "Service owner", priority: "P1" },
    ]);
  });

  it("keeps incomplete useful legacy records and ignores malformed rows", () => {
    expect(buildResponseActions({
      investigation_checklist: [null, "broken", {}, { command: "show pool", expected: false }],
      mitigation_plan: [{ rollback: "Restore old setting", risk: 23 }],
      follow_ups: [{ owner_role: "Service owner" }, { priority: "P2", item: null }],
    })).toMatchObject([
      { id: "investigation:0", title: "", command: "show pool", expected: "" },
      { id: "mitigation:0", title: "", risk: "", rollback: "Restore old setting" },
      { id: "follow_up:0", title: "", suggestedOwner: "Service owner" },
      { id: "follow_up:1", title: "", priority: "P2" },
    ]);
  });

  it("gives duplicate source rows distinct positional identities", () => {
    const row = { step: "Check pool", command: "show pool", expected: "Saturation" };
    expect(buildResponseActions({ investigation_checklist: [row, row] }).map(item => item.id)).toEqual(["investigation:0", "investigation:1"]);
  });

  it.each([null, undefined, false, [], {}, { investigation_checklist: "not an array" }])("handles missing actions: %s", value => {
    expect(buildResponseActions(value)).toEqual([]);
  });
});

describe("operator progress", () => {
  it("defaults every untouched action to todo with no assigned owner or outcome", () => {
    expect(getActionProgress({}, "follow_up:0")).toEqual({ status: "todo", owner: "", outcome: "" });
    expect(summarizeResponseProgress(actions, {})).toEqual({ total: 4, todo: 4, in_progress: 0, blocked: 0, done: 0 });
    expect(getActionProgress(progress, "follow_up:0").owner).toBe("");
  });

  it("counts manual statuses without treating suggested owner roles as assignments", () => {
    expect(summarizeResponseProgress(actions, progress)).toEqual({ total: 4, todo: 1, in_progress: 1, blocked: 1, done: 1 });
    expect(summarizeResponseProgress([], progress)).toEqual({ total: 0, todo: 0, in_progress: 0, blocked: 0, done: 0 });
  });

  it("whitelists current actions, known statuses, and operator fields", () => {
    const result = sanitizeResponseProgress(actions, {
      "investigation:0": { status: "done", owner: "Alice", outcome: "Pool checked", command: "override source", secret_field: "ignore" },
      "investigation:1": { status: "executed", owner: "Bob", outcome: "Manual note retained" },
      "mitigation:0": { status: "blocked", owner: 42, outcome: null },
      "follow_up:0": { status: "todo", owner: "", outcome: "" },
      "unknown:0": { status: "done", owner: "Eve", outcome: "Must not attach to a current action" },
    });
    expect(result).toEqual({
      "investigation:0": { status: "done", owner: "Alice", outcome: "Pool checked" },
      "investigation:1": { status: "todo", owner: "Bob", outcome: "Manual note retained" },
      "mitigation:0": { status: "blocked", owner: "", outcome: "" },
    });
  });

  it("bounds owner/outcome after redaction and leaves source objects untouched", () => {
    const token = "sk-" + "a".repeat(30);
    const entry = Object.freeze({ status: "done", owner: `key ${token} ${"x".repeat(200)}`, outcome: `${token} ${"y".repeat(5000)}` });
    const original = Object.freeze({ "investigation:0": entry });
    const result = sanitizeResponseProgress(actions, original);
    expect(result["investigation:0"].owner).toHaveLength(RESPONSE_LIMITS.owner);
    expect(result["investigation:0"].outcome).toHaveLength(RESPONSE_LIMITS.outcome);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result["investigation:0"].outcome).toContain("[REDACTED: OpenAI API key]");
    expect(entry.outcome).toContain(token);
  });

  it("ignores prototype entries and creates safe own properties for whitelisted IDs", () => {
    const inherited = Object.create({ "investigation:0": { status: "done", owner: "Inherited", outcome: "Wrong" } });
    expect(sanitizeResponseProgress(actions, inherited)).toEqual({});
    expect(getActionProgress(inherited, "investigation:0")).toEqual({ status: "todo", owner: "", outcome: "" });
    const poisoned = JSON.parse('{"__proto__":{"status":"done","owner":"Safe data","outcome":"No prototype mutation"}}');
    const result = sanitizeResponseProgress([{ ...actions[0], id: "__proto__" }], poisoned);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(getActionProgress(result, "__proto__").owner).toBe("Safe data");
  });

  it("does not read or persist inherited operator fields from action rows", () => {
    const row = Object.create({ status: "done", owner: "Inherited owner", outcome: "Inherited outcome" });
    const input = { "investigation:0": row };
    expect(getActionProgress(input, "investigation:0")).toEqual({ status: "todo", owner: "", outcome: "" });
    expect(sanitizeResponseProgress(actions, input)).toEqual({});
    row.outcome = "Own observation";
    expect(sanitizeResponseProgress(actions, input)).toEqual({ "investigation:0": { status: "todo", owner: "", outcome: "Own observation" } });
  });

  it.each([null, false, [], "broken", { "investigation:0": [] }])("safely drops corrupt progress shapes: %s", value => {
    expect(sanitizeResponseProgress(actions, value)).toEqual({});
  });
});

describe("response handoff exports", () => {
  it("exports all recommendations with manual outcomes kept separate", () => {
    const markdown = buildResponseHandoffMarkdown(source, context, progress);
    expect(markdown).toContain("Statuses, assigned owners and observed outcomes are recorded manually");
    expect(markdown).toContain("Total: 4 · To do: 1 · In progress: 1 · Blocked: 1 · Done: 1");
    expect(markdown).toContain("## Blockers\n\n- mitigation:0");
    expect(markdown).toContain("**Command to investigate:**\n\n```\nkubectl logs deploy/checkout\n```");
    expect(markdown).toContain("**Expected result:** Connection acquisition timeout");
    expect(markdown).toContain("**Risk:** Recent fixes are removed");
    expect(markdown).toContain("**Rollback:** Redeploy the current version");
    expect(markdown).toContain("**Suggested owner role:** Service owner");
    expect(markdown).toContain("**Priority:** P1");
    expect(markdown).toContain("**Source recommendation**");
    expect(markdown).toContain("**Operator record**");
    expect(markdown).toContain("**Assigned owner:** Alice");
    expect(markdown).toContain("**Observed outcome / notes:**\n\n```\nObserved 80 pending connections.\n```");
    const json = JSON.parse(buildResponseHandoffJson(source, context, progress));
    expect(json.actions[0]).toEqual({ recommendation: actions[0], operator_record: progress["investigation:0"] });
    expect(json.actions[3].operator_record).toEqual({ status: "todo", owner: "", outcome: "" });
    expect(json.blockers).toEqual(["mitigation:0"]);
    expect(json.next_actions).toEqual(["investigation:1", "mitigation:0", "follow_up:0"]);
    expect(json.analysis.id).toBe("analysis-2");
    expect(json.incident.id).toBe("incident-1");
  });

  it("excludes completed actions only from the next-actions list, retaining their source and outcomes", () => {
    const markdown = buildResponseHandoffMarkdown(source, context, progress);
    const next = markdown.split("## Next actions\n")[1].split("## Investigation checks")[0];
    expect(next).not.toContain("investigation:0");
    expect(markdown).toContain("### 1. Inspect pool (investigation:0)");
    expect(markdown).toContain("Observed 80 pending connections.");
  });

  it("never exports raw context, symptoms or arbitrary source/progress fields", () => {
    const unexpectedSource = { ...source, raw_context: context.raw_context, symptoms: context.symptoms, private_debug: "DEBUG_MUST_NOT_EXPORT" };
    const unexpectedProgress = { ...progress, "unknown:0": { status: "done", owner: "UNKNOWN_MUST_NOT_EXPORT", outcome: "UNKNOWN_MUST_NOT_EXPORT" } } as ResponseProgress;
    for (const report of [buildResponseHandoffMarkdown(unexpectedSource, context, unexpectedProgress), buildResponseHandoffJson(unexpectedSource, context, unexpectedProgress)]) {
      expect(report).not.toContain("RAW_LOGS_MUST_NOT_EXPORT");
      expect(report).not.toContain("SYMPTOMS_MUST_NOT_EXPORT");
      expect(report).not.toContain("DEBUG_MUST_NOT_EXPORT");
      expect(report).not.toContain("UNKNOWN_MUST_NOT_EXPORT");
    }
    const json = JSON.parse(buildResponseHandoffJson(source, context, progress));
    expect(Object.keys(json.incident).sort()).toEqual(["id", "service", "title"]);
  });

  it("redacts known credentials from source recommendations, allowed context and notes", () => {
    const token = "sk-" + "a".repeat(30);
    const secretSource = {
      ...source, summary: `Checkout failed using ${token}`,
      investigation_checklist: [{ step: `Check ${token}`, command: `curl -H 'key: ${token}'`, expected: `No ${token}` }],
      mitigation_plan: [{ action: `Roll back ${token}`, risk: `Risk ${token}`, rollback: `Restore ${token}` }],
      follow_ups: [{ item: `Rotate ${token}`, owner_role: `Owner ${token}`, priority: "P1" }],
    };
    const notes: ResponseProgress = { "investigation:0": { status: "done", owner: token, outcome: `Found ${token}` } };
    for (const report of [buildResponseHandoffMarkdown(secretSource, { ...context, title: token, service: token }, notes), buildResponseHandoffJson(secretSource, { ...context, title: token, service: token }, notes)]) {
      expect(report).not.toContain(token);
      expect(report).toContain("[REDACTED: OpenAI API key]");
    }
    expect(secretSource.summary).toContain(token);
    expect(notes["investigation:0"].owner).toBe(token);
  });

  it("fences commands safely and prevents titles from injecting report headings", () => {
    const command = "printf '``` and ````'\necho done";
    const report = buildResponseHandoffMarkdown({ ...source, investigation_checklist: [{ step: "Inspect\n# forged heading", command, expected: "Inspect output" }] }, {
      ...context, title: "Incident\n# forged title",
    }, {});
    expect(report).toContain(`\n\`\`\`\`\`\n${command}\n\`\`\`\`\`\n`);
    expect(report).not.toContain("\n# forged");
    expect(report).toContain("Inspect \\# forged heading");
  });

  it("supports Chinese labels without translating source evidence or operator outcomes", () => {
    const report = buildResponseHandoffMarkdown(source, context, progress, { locale: "zh" });
    expect(report).toContain("## 阻塞项");
    expect(report).toContain("## 缓解行动");
    expect(report).toContain("**风险:** Recent fixes are removed");
    expect(report).toContain("**回滚:** Redeploy the current version");
    expect(report).toContain("**操作人员记录**");
    expect(report).toContain("**状态:** 已完成");
    expect(report).toContain("Observed 80 pending connections.");
    expect(JSON.parse(buildResponseHandoffJson(source, context, progress, { locale: "zh" })).locale).toBe("zh");
  });

  it("keeps operator owners and arbitrary notes from changing recommendation provenance", () => {
    const outcome = "# Source recommendation\n```\nObserved output\n```";
    const report = buildResponseHandoffMarkdown(source, context, {
      "investigation:0": { status: "done", owner: "Alice\n## forged owner heading", outcome },
    });
    expect(report).toContain("**Assigned owner:** Alice \\#\\# forged owner heading");
    expect(report).not.toContain("\n## forged owner heading");
    expect(report).toContain(`**Observed outcome / notes:**\n\n\`\`\`\`\n${outcome}\n\`\`\`\`\n`);
  });

  it("exports missing legacy action fields as unrecorded without inventing outcomes", () => {
    const report = buildResponseHandoffMarkdown({ mitigation_plan: [{ action: "Reduce load" }] }, {}, {});
    expect(report).toContain("**Risk:** Not recorded");
    expect(report).toContain("**Rollback:** Not recorded");
    expect(report).toContain("**Observed outcome / notes:**\n\nNot recorded");
    expect(report).not.toContain("undefined");
    expect(report).not.toContain("[object Object]");
  });

  it("supports empty action sets without stale progress or next actions", () => {
    const json = JSON.parse(buildResponseHandoffJson(null, {}, progress));
    expect(json.actions).toEqual([]);
    expect(json.blockers).toEqual([]);
    expect(json.next_actions).toEqual([]);
    expect(json.progress_summary.total).toBe(0);
    expect(buildResponseHandoffMarkdown(null, {}, progress)).toContain("## Next actions\n\nNone");
  });
});
