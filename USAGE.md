# 使用指南 — AI Reliability Copilot

这份文档讲：**作为用户怎么用**（不是怎么开发）。如果你刚 clone repo 想试试或部署到团队用，从这里开始。

> English-speaking team? Mostly the same workflow — the UI has a 中文/English toggle in the top right.

---

## 0. 一句话功能总览

| 你输入 | AI 给你 | 用在哪里 |
|---|---|---|
| 一段事故上下文（log / 指标 / on-call 笔记） | 9 段结构化响应：摘要、SEV、根因假设、排查清单、缓解方案、postmortem 草稿、follow-up | 凌晨被 page 醒后的 5 分钟内 |
| Datadog / PagerDuty / Sentry alert JSON | 同上（自动解析字段） | 不想打字 |
| 公司内部 runbook / 历史 postmortem | AI 每次分析会引用相关片段 | 让 AI 懂你们的系统 |
| 任意场景中选一个 | 一键跑分析 + 对比 prompt 版本 | demo / 测试 prompt |

---

## 1. 第一次启动（5 分钟）

### 1.1 准备 3 个东西

| 需要什么 | 哪里拿 | 必需？ |
|---|---|---|
| **DeepSeek API key** | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) | ✅ 必需，每次分析 ~$0.002 |
| **Supabase 项目** | [supabase.com/dashboard](https://supabase.com/dashboard)（free tier 够用） | ✅ 必需，存事故/分析/eval |
| **OpenAI API key** | [platform.openai.com](https://platform.openai.com/api-keys) | ⭕ 可选，启用后语义检索准很多（~$0.10/月） |

### 1.2 本地配置

```bash
# 1. clone & install
git clone https://github.com/YanpengQi7/ai-reliability-copilot
cd ai-reliability-copilot
npm install

# 2. 创建 .env.local（参考 .env.local.example）
cat > .env.local <<'EOF'
DEEPSEEK_API_KEY=sk-你的key
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_或legacy_anon
SUPABASE_SERVICE_ROLE_KEY=sb_secret_或legacy_service_role  # ← 服务端用，会绕过 RLS
# 可选：OPENAI_API_KEY=sk-...
EOF

# 3. 在 Supabase SQL Editor 里粘贴并运行 supabase/schema.sql
#    （会创建 6 个表 + 索引 + 4 个 RPC 函数 + 启用 vector / pg_trgm 扩展）

# 4. 灌 5 个示例场景（DB pool / OOM / dependency / DNS / cache stampede）
npm run seed:scenarios

# 5. 启动
npm run dev
# → http://localhost:3000
```

如果浏览器打开看到首页 + 右上角能切语言 + `/incidents` 显示 "暂无故障记录"（不是 "数据库未配置"），就齐了。

---

## 2. 五种核心工作流

### 工作流 A：手动粘一段事故文字 → 拿到结构化分析

最基本的用法，适合 on-call 中拿到一段混乱的 Slack 讨论 / log。

1. 打开主页
2. 把上下文粘进 "原始上下文" 框（至少 20 字）。可填 `服务` + `症状`（可选，AI 也能猜）
3. 选 Prompt 版本（v1 / v2）和输出语言（English / 中文）
4. 点 **分析故障**
5. AI 流式输出 9 段，结束后自动跳转到 `/incidents/[id]` 永久保存

后续可以：
- 在详情页换个 prompt 重新跑（**用 prompt v1 / v2 重新运行**）
- 点 **用 rubric 评估** 让另一个 LLM 给打分
- 点命令右上角的 **Copy** 复制到终端

---

### 工作流 B：粘 alert JSON → AI 自动解析

凌晨 3 点被 Datadog page 醒，alert payload 就在 Slack 里。**不要打字**。

1. 整段 JSON 粘进 "原始上下文" 框
2. 点框右上角的 **🟢 解析告警 JSON**
3. 标题 / 服务 / 症状自动填好，原始上下文重写成结构化清单
4. 直接点 **分析故障**

支持的 3 家：
- **Datadog** webhook event（识别 `alert_id` / `alert_title` / `alert_metric`）
- **PagerDuty** events API v2 + webhook v3（识别 `event.event_type` / `messages[]` / `incident`）
- **Sentry** issue alert（识别 `data.issue` / 裸 `issue`）

不识别就会显示 "未识别的告警格式" —— 这时直接当文本用。

---

### 工作流 C：把公司内部文档塞进知识库 → AI 引用着回答

**这是这个工具变成 "公司专属" 的关键**。AI 默认只懂通用 SRE，灌了你们的 runbook 之后就懂你们的服务名、SLO、过去出过什么事。

```bash
# 1. 把你们公司的 markdown 文件放到一个目录（或者用项目自带的 sample-kb/）
ls sample-kb/
# runbook-payment-svc.md  postmortem-2026-03-12-payment-svc.md  service-catalog.md

# 2. 灌进去
npm run kb:ingest              # 默认 ./sample-kb
# 或者你公司自己的目录：
npm run kb:ingest -- ./docs/runbooks
npm run kb:ingest -- ./docs --kind=runbook   # 强制全部当 runbook

# 输出类似：
# embedding provider: none (trigram-only mode — set OPENAI_API_KEY for semantic search)
# found 3 markdown files
#   ✓  postmortem-2026-03-12-payment-svc.md (postmortem, 3 chunks)
#   ✓  runbook-payment-svc.md (runbook, 2 chunks)
#   ✓  service-catalog.md (service, 2 chunks)
# done: 3 ingested · 0 unchanged · 7 chunks written
```

**自动 kind 识别规则**（按文件名）：
- 含 `postmortem` / `incident-report` → `postmortem`
- 含 `runbook` / `playbook` → `runbook`
- 含 `service` / `catalog` → `service`
- 含 `architecture` / `arch-` → `architecture`
- 其他 → `other`

**幂等**：基于 SHA256 内容哈希。文件没变就跳过，不浪费 embedding 费用。

**两种检索后端**：
- 有 `OPENAI_API_KEY` → pgvector + `text-embedding-3-small`（语义匹配，准）
- 没有 → pg_trgm（词法匹配，~70% 一样好，免费）

灌完之后，**每次分析自动注入 top-5 相关片段**到 prompt。在 `/kb` 看已灌的 doc 列表；在事故详情页能看到 "AI 参考的内部文档" 卡片，标明哪些段被引用了（**审计追溯**）。

#### 内部文档应该写成什么样

最好的 runbook 包含：
- **服务一句话定位** + 上下游
- **常见失败模式 + 错误关键词** （让 AI 能搜到）
- **危险操作的提示**（"千万不要 restart prod，要 failover"）
- **历史事故清单**（让 AI "我们 2025-08 见过类似情况"）

参考 [sample-kb/runbook-payment-svc.md](sample-kb/runbook-payment-svc.md) 和 [sample-kb/postmortem-2026-03-12-payment-svc.md](sample-kb/postmortem-2026-03-12-payment-svc.md)。

---

### 工作流 D：从场景库一键 demo

适合：第一次给同事看 / 教新人 / 验证 prompt 改动没破坏什么。

1. 打开 `/scenarios`，5 个场景一目了然（DB pool / OOM / dependency timeout / DNS / cache stampede）
2. 每个场景都附了完整 raw context（点 "展开原始上下文" 看）
3. 点 **用 AI 分析** → 自动跑 + 跳详情页

这 5 个场景**也是 prompt 评估的 regression suite**。改了 prompt 之后跑 `npm run evals:run` 就会对比所有 5 个的得分。

---

### 工作流 E：查看 / 分析数据

#### `/incidents` — 所有跑过的事故
按时间倒序，点进去看分析、相似历史事故、引用了哪些 KB 片段。

#### `/incidents/[id]` 详情页能看到什么
- **9 段分析**（最新版本展开）
- **"AI 参考的内部文档"** — 列出 RAG 检索到并引用的 KB 片段（带相似度 %）
- **"相似历史故障"** — 用 pgvector / pg_trgm 找的过去类似事故（带相似度 %）
- **历史分析版本** — 折叠面板里能看到同一事故的多个分析（不同 prompt / 语言）
- **重新运行按钮** — 换个 prompt 再跑一次
- **评估按钮** — 让 LLM judge 打分

#### `/evals` — 评估 dashboard
- **成本 & 用量** — 总花费 / 单次平均 / 总 token / 平均延迟
- **按 prompt 版本平均分** — v1 vs v2 哪个好（按维度拆解）
- **按输出语言平均分** — en vs zh（哪个 dim 下降最多）
- **单次评估列表** — 每行点开看 judge 给每维度的评分理由

#### `/kb` — 知识库管理
- 已灌的 doc 列表 + kind 标签
- 总数：文档数 / chunk 数 / 已 embedded 的 chunk 数

---

## 3. 跑批量 evaluation（衡量 prompt 是不是真的变好）

```bash
npm run evals:run
```

会跑 **5 场景 × 2 prompt 版本 × 2 输出语言 = 20 次评估**（约 5 分钟，~$0.04）。

输出形如：

```
=== Summary: overall by (version, language) ===
scenario                            v1·en  v1·zh  v2·en  v2·zh
db-connection-pool-exhausted          4.8    4.6    4.6    4.6
bad-deploy-memory-leak                5.0    —     4.4    —
upstream-dependency-timeout           4.8    4.8    4.8    4.2
dns-misconfiguration                  4.4    4.2    4.2    4.2
cache-stampede                        4.4    4.8    4.6    4.4
AVERAGE                              4.68   4.60   4.52   4.35

=== Marginal averages ===
v1 overall: 4.64
v2 overall: 4.44
```

跑完后到 `/evals` 看可视化。每次改了 `src/lib/prompts.ts` 都建议跑一次。

---

## 4. 部署到内部 / Vercel

### Vercel 部署（推荐 — 5 分钟）

```bash
# 装 Vercel CLI（一次性）
npm i -g vercel@latest

# 在项目目录里
vercel link          # 关联或新建项目
vercel env add DEEPSEEK_API_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# 可选：
vercel env add OPENAI_API_KEY production

vercel --prod
```

之后 push 到 main 自动部署（GitHub Actions CI 会先跑 tsc + lint + build）。

### 公司内网部署

任何能跑 Node 22+ 的地方都行：

```bash
npm run build
NODE_ENV=production npm start   # 默认 :3000
```

只要环境变量配齐就跑。Postgres 不一定要 Supabase —— 任何带 `pgvector` 和 `pg_trgm` 扩展的 Postgres 都行（aws RDS、Cloud SQL、自建都可以），改 connection string 就行。

### Health check
```
GET /api/healthz
→ 200 OK + JSON 包含每个依赖的健康状态
→ 503 + 哪个失败 + 失败原因
```

接 BetterStack / Pingdom / Vercel Monitor 一键配监控。

---

## 5. 命令速查表

| 命令 | 干嘛 |
|---|---|
| `npm run dev` | 启动本地开发（http://localhost:3000） |
| `npm run build && npm start` | 生产构建 + 跑 |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | 类型检查 |
| `npm run seed:scenarios` | 灌 5 个示例 SRE 场景到 DB |
| `npm run kb:ingest` | 灌默认 `./sample-kb/` 的 markdown 到知识库 |
| `npm run kb:ingest -- ./your-dir` | 灌指定目录 |
| `npm run kb:ingest -- ./d --kind=runbook` | 强制 kind |
| `npm run evals:run` | 跑 20 次 cross-lingual eval batch |
| `npm run backfill:similar` | 给已有但缺 signature / embedding 的事故补字段 |

---

## 6. 数据隐私 & 安全

| 谁能看到什么 |  |
|---|---|
| **LLM provider (DeepSeek / OpenAI)** | 看到你贴的事故内容 + KB 检索到的片段。**不要贴 PII / 客户数据 / 密钥**。 |
| **你的 Supabase 数据库** | 全部数据，包括 raw_context、embedding。RLS 默认没启用（service-role 客户端绕过）。如果要多租户上线，必须加 RLS + Supabase Auth。 |
| **Vercel logs** | 看到 API 请求路径 + status code，**不看到 body**。 |

**生产部署 checklist**：
- [ ] OPENAI_API_KEY 设了 hard spend limit（OpenAI dashboard）
- [ ] DEEPSEEK_API_KEY 设了 hard spend limit
- [ ] Supabase service_role 永远不在浏览器代码里出现
- [ ] `/api/analyze` 的 rate limiter（5 req/min）够不够 —— 内部用建议改成 Redis-backed
- [ ] 内部敏感 doc 灌进 KB 前先脱敏

---

## 7. 常见问题

**Q: 我贴了 alert JSON 但点 "解析告警" 没反应？**
A: 看 textarea 下方有没有 "未识别的告警格式"。如果不是 Datadog / PagerDuty / Sentry 这 3 家的标准 webhook 形状，会落到 raw 模式 —— 直接点分析也行。要支持新 provider，加一个 parser 到 [src/lib/alertParsers.ts](src/lib/alertParsers.ts)。

**Q: 我看 "AI 参考的内部文档" 是空的？**
A: 三种可能：(1) 知识库还没灌 doc — 跑 `npm run kb:ingest`；(2) 没有 OPENAI_API_KEY 且 trigram 没找到匹配 — 调低 `src/lib/kb.ts` 的 `trigramThreshold` 或换个查询词；(3) 老的事故是改这功能之前创建的 — 新跑一次就有了。

**Q: AI 输出英文 / 中文混杂？**
A: 命令 / SQL / kubectl 故意保持英文（不然 copy-paste 会坏）。Narrative 部分跟选的输出语言走。这是设计，不是 bug。

**Q: prompt v2 怎么反而比 v1 分低？**
A: 我们也很意外。详细分析在 [notes/eval-run-1.md](notes/eval-run-1.md) 和 [docs/blog-2-eval-is-the-product.md](docs/blog-2-eval-is-the-product.md)。结论是：v2 加的硬约束（必须有 rollback、postmortem 必须有 9 个 H2）让模型产出更"清单化"、丢了 completeness 分。**这就是为什么必须有 eval pipeline** —— 不然这个 regression 就 ship 出去了。

**Q: 想给某段分析加自定义 metadata（比如 ticket ID）？**
A: 给 `incidents` 表加一列（用 `alter table` 或 MCP 的 `apply_migration`），更新 `src/lib/db.ts` 的 `IncidentRow` 类型，在 save 时存进去，详情页读出来。完整步骤在 [CLAUDE.md](CLAUDE.md) → "Add a new DB column"。

---

## 8. 想深入

- **架构 / 文件位置** → [CLAUDE.md](CLAUDE.md)
- **评估方法论** → [EVALUATION.md](EVALUATION.md)
- **30 天 build log** → [notes/](notes/)
- **博客底稿（可发 Substack / dev.to）** → [docs/blog-1-building-the-copilot.md](docs/blog-1-building-the-copilot.md), [docs/blog-2-eval-is-the-product.md](docs/blog-2-eval-is-the-product.md)
- **简历 / CARL 故事 / LinkedIn 文案** → [docs/portfolio.md](docs/portfolio.md)
