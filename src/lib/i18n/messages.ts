// All user-facing UI strings, keyed by locale.
// Add a key here first, then `useT('key')` in components.
// Output-language (LLM-generated) strings are NOT here — those flow from the API.

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

type Messages = Record<string, Record<Locale, string>>;

export const MESSAGES: Messages = {
  // Nav
  "nav.new": { en: "New", zh: "新建" },
  "nav.incidents": { en: "Incidents", zh: "故障" },
  "nav.scenarios": { en: "Scenarios", zh: "场景库" },
  "nav.evals": { en: "Evals", zh: "评估" },

  // Common
  "common.loading": { en: "Loading...", zh: "加载中..." },
  "common.error": { en: "Error", zh: "错误" },
  "common.back": { en: "Back", zh: "返回" },
  "common.cancel": { en: "Cancel", zh: "取消" },
  "common.copy": { en: "Copy", zh: "复制" },
  "common.copied": { en: "Copied", zh: "已复制" },

  // Home (New)
  "home.title": { en: "AI Reliability Copilot", zh: "AI 故障响应副驾" },
  "home.subtitle": {
    en: "Paste an incident. Get a structured 9-section response: summary, severity, root cause hypotheses, investigation checklist, mitigation, postmortem, follow-ups.",
    zh: "粘贴一段故障上下文。AI 给你一份结构化的 9 段响应：摘要、严重等级、根因假设、排查清单、缓解方案、postmortem、后续行动项。",
  },
  "home.demoLimit": { en: "Demo · 5 req/min", zh: "Demo · 5 次/分钟" },
  "home.field.title": { en: "Title", zh: "标题" },
  "home.field.service": { en: "Affected service", zh: "受影响服务" },
  "home.field.symptoms": { en: "Symptoms", zh: "症状" },
  "home.field.rawContext": {
    en: "Raw context (logs, metrics, on-call notes)",
    zh: "原始上下文（日志、指标、on-call 笔记）",
  },
  "home.promptLabel": { en: "Prompt:", zh: "Prompt：" },
  "home.outputLanguage": { en: "Output:", zh: "输出语言：" },
  "home.analyze": { en: "Analyze incident", zh: "分析故障" },
  "home.streaming": { en: "Streaming...", zh: "生成中..." },
  "home.saving": { en: "Saving...", zh: "保存中..." },
  "home.savingHint": { en: "Saving and redirecting...", zh: "保存并跳转中..." },
  "home.generatingHint": { en: "AI is generating sections...", zh: "AI 正在生成各段..." },
  "home.errorMissingKey": {
    en: "Server is missing DEEPSEEK_API_KEY. Set it in Vercel → Settings → Environment Variables and redeploy.",
    zh: "服务端缺少 DEEPSEEK_API_KEY。请在 Vercel → Settings → Environment Variables 中设置后重新部署。",
  },

  // Analysis sections (UI labels — content stays in the LLM-output language)
  "section.summary": { en: "Summary", zh: "摘要" },
  "section.severityReasoning": { en: "Severity reasoning:", zh: "严重等级理由：" },
  "section.rootCauses": { en: "Root cause hypotheses", zh: "根因假设" },
  "section.evidence": { en: "Evidence:", zh: "证据：" },
  "section.investigation": { en: "Investigation checklist", zh: "排查清单" },
  "section.expected": { en: "Expected:", zh: "预期结果：" },
  "section.mitigation": { en: "Mitigation plan", zh: "缓解方案" },
  "section.risk": { en: "Risk:", zh: "风险：" },
  "section.rollback": { en: "Rollback:", zh: "回滚：" },
  "section.customerImpact": { en: "Customer impact", zh: "客户影响" },
  "section.postmortem": { en: "Postmortem draft", zh: "Postmortem 草稿" },
  "section.followUps": { en: "Follow-ups", zh: "后续行动项" },

  // Incidents list
  "incidents.title": { en: "Incidents", zh: "故障列表" },
  "incidents.empty.title": { en: "No incidents yet", zh: "暂无故障记录" },
  "incidents.empty.body": {
    en: "Submit one on the New page to see it here.",
    zh: "在「新建」页面提交一条故障即可在此查看。",
  },
  "incidents.dbMissing.title": { en: "Database not configured", zh: "数据库未配置" },
  "incidents.dbMissing.body": {
    en: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to see saved incidents.",
    zh: "设置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 后即可看到保存的故障。",
  },
  "incidents.untitled": { en: "Untitled incident", zh: "未命名故障" },

  // Incident detail
  "detail.allIncidents": { en: "← All incidents", zh: "← 全部故障" },
  "detail.untitled": { en: "Untitled", zh: "未命名" },
  "detail.service": { en: "service:", zh: "服务：" },
  "detail.created": { en: "created:", zh: "创建时间：" },
  "detail.rawContext": { en: "Raw incident context", zh: "原始故障上下文" },
  "detail.noAnalyses": { en: "No analyses yet.", zh: "暂无分析。" },
  "detail.earlierVersions": {
    en: "earlier analysis version(s)",
    zh: "更早的分析版本",
  },
  "detail.rerunV": { en: "Re-run with prompt", zh: "用 prompt 重新运行" },
  "detail.runningV": { en: "Running", zh: "运行中" },
  "detail.evaluate": { en: "Evaluate with rubric", zh: "用 rubric 评估" },
  "detail.judging": { en: "Judging...", zh: "评分中..." },
  "detail.scored": { en: "Scored", zh: "得分" },

  // Scenarios
  "scenarios.title": { en: "Scenario library", zh: "场景库" },
  "scenarios.subtitle": {
    en: "5 curated SRE incidents. One click to feed any of them through the copilot.",
    zh: "5 个精心策划的 SRE 场景。一键发送给 AI 副驾分析。",
  },
  "scenarios.expected": { en: "expected:", zh: "预期：" },
  "scenarios.showContext": { en: "Show raw context", zh: "展开原始上下文" },
  "scenarios.runWithAI": { en: "Run with AI", zh: "用 AI 分析" },
  "scenarios.running": { en: "Running...", zh: "运行中..." },

  // Evals
  "evals.title": { en: "Evaluations", zh: "评估" },
  "evals.subtitle": {
    en: "Rubric v1 · 5 dims · LLM-as-judge (DeepSeek). Each row is an analysis scored 1–5 per dim.",
    zh: "Rubric v1 · 5 维度 · LLM 评判（DeepSeek）。每行是一次分析，每维度 1–5 分。",
  },
  "evals.byVersion": { en: "Average by prompt version", zh: "按 prompt 版本平均分" },
  "evals.byLanguage": { en: "Average by output language", zh: "按输出语言平均分" },
  "evals.runHint": {
    en: "No evaluations yet. Run npm run evals:run.",
    zh: "暂无评估。运行 npm run evals:run。",
  },
  "evals.individual": { en: "Individual evaluations", zh: "单次评估" },

  // Rubric dim labels
  "rubric.specificity": { en: "Specificity", zh: "具体性" },
  "rubric.safety": { en: "Safety", zh: "安全性" },
  "rubric.actionability": { en: "Actionability", zh: "可执行性" },
  "rubric.domainCorrectness": { en: "Domain correctness", zh: "领域正确性" },
  "rubric.completeness": { en: "Completeness", zh: "完整性" },
};

export function t(locale: Locale, key: string): string {
  const m = MESSAGES[key];
  if (!m) return key; // surface missing keys instead of silently failing
  return m[locale] ?? m[DEFAULT_LOCALE] ?? key;
}
