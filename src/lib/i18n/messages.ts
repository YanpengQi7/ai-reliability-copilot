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
  "nav.kb": { en: "KB", zh: "知识库" },
  "nav.mcpUsage": { en: "MCP", zh: "MCP" },

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
    en: "Raw context (logs, metrics, on-call notes) — or paste a Datadog/PagerDuty/Sentry alert JSON",
    zh: "原始上下文（日志、指标、on-call 笔记）—— 或粘贴 Datadog / PagerDuty / Sentry alert JSON",
  },
  "home.parseAlert": { en: "Parse alert JSON", zh: "解析告警 JSON" },
  "home.trySample": { en: "Load sample:", zh: "试用样例：" },
  "home.parsed": { en: "Parsed from", zh: "已解析" },
  "home.notRecognized": { en: "Not a recognized alert payload", zh: "未识别的告警格式" },
  "home.uploadScreenshot": { en: "📷 Attach screenshot (Grafana, error page, stack trace…)", zh: "📷 附加截图（Grafana、错误页、堆栈…）" },
  "home.describingImage": { en: "Analyzing image…", zh: "正在分析图像…" },
  "home.imageDescribed": { en: "Image description added to context", zh: "图像描述已加入上下文" },
  "home.visionMissingKey": { en: "Set OPENAI_API_KEY to enable image analysis", zh: "设置 OPENAI_API_KEY 后可分析图像" },
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
  "detail.similar.title": { en: "Similar past incidents", zh: "相似历史故障" },
  "detail.similar.none": { en: "No similar incidents found in the library yet.", zh: "知识库中暂无相似故障。" },
  "detail.similar.mode.vector": { en: "semantic match (pgvector)", zh: "语义匹配 (pgvector)" },
  "detail.similar.mode.trigram": { en: "lexical match (pg_trgm)", zh: "词法匹配 (pg_trgm)" },
  "detail.kb.title": { en: "Internal docs used by the AI", zh: "AI 参考的内部文档" },
  "detail.kb.empty": { en: "No KB chunks were used (knowledge base may be empty).", zh: "本次未使用任何知识库片段（知识库可能为空）。" },
  "kb.title": { en: "Knowledge base", zh: "知识库" },
  "kb.subtitle": {
    en: "Internal docs (runbooks, postmortems, service catalog) ingested as chunks + embeddings. The AI retrieves the top 5 most relevant chunks for every incident analysis.",
    zh: "已摄入的内部文档（runbook、postmortem、服务目录）切分为 chunk + embedding。AI 每次分析时会检索最相关的 5 个 chunk。",
  },
  "kb.empty": { en: "No docs ingested yet. Run npm run kb:ingest from the project root.", zh: "知识库为空。在项目根目录运行 npm run kb:ingest。" },
  "kb.totalDocs": { en: "Documents", zh: "文档数" },
  "kb.totalChunks": { en: "Chunks", zh: "Chunk 数" },
  "kb.totalEmbedded": { en: "Embedded chunks", zh: "已 embedded 的 chunk" },

  // MCP usage dashboard
  "mcp.title": { en: "MCP usage", zh: "MCP 用量" },
  "mcp.subtitle": {
    en: "Every tool call to /api/mcp is logged here (audit). No input/output content stored — just shape + timing.",
    zh: "每次 /api/mcp 工具调用都记在这里（审计）。不存完整 input/output —— 只存形状 + 耗时。",
  },
  "mcp.totalCalls": { en: "Calls (7d)", zh: "调用数 (7d)" },
  "mcp.errorRate": { en: "Error rate", zh: "错误率" },
  "mcp.avgLatency": { en: "Avg latency", zh: "平均延迟" },
  "mcp.uniqueIps": { en: "Unique IPs (7d)", zh: "独立 IP (7d)" },
  "mcp.byTool": { en: "By tool (last 7 days)", zh: "按工具（最近 7 天）" },
  "mcp.recentFailures": { en: "Recent failures", zh: "最近失败" },
  "mcp.noData": { en: "No tool calls yet. Wire up your Claude Code and call a tool.", zh: "暂无调用记录。把你的 Claude Code 接上来调一次工具试试。" },
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
  "evals.cost.title": { en: "Cost & usage", zh: "成本 & 用量" },
  "evals.cost.totalCost": { en: "Total spend", zh: "总花费" },
  "evals.cost.avgCost": { en: "Avg per analysis", zh: "单次平均" },
  "evals.cost.totalTokensIn": { en: "Total input tokens", zh: "输入 token 总计" },
  "evals.cost.totalTokensOut": { en: "Total output tokens", zh: "输出 token 总计" },
  "evals.cost.avgLatency": { en: "Avg latency", zh: "平均延迟" },
  "evals.cost.sample": { en: "n =", zh: "样本数 =" },
  "evals.cost.note": {
    en: "Excludes the streaming /api/analyze path — usage isn't reachable from that flow (limitation, not a bug). Includes batch evals + scenario runs + re-runs.",
    zh: "不含流式 /api/analyze 路径（该路径无法获取 usage，是已知限制）。仅含 batch eval + scenario run + re-run。",
  },

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
