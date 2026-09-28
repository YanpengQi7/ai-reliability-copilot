# 核心竞争力与 Eval 实施计划

更新：2026-09-27。范围：本地代码审阅、历史评测产物核对、实施规划；本次不修改业务代码，不运行收费模型评测。

## 1. 要建立的核心竞争力

**把不完整、相互矛盾的告警和证据，转成可核验的诊断与下一步动作，并用可复现评测证明：在哪些事故上比直接问模型更可靠，额外成本是否值得。**

建议把约 70% 的下一阶段投入放在 eval、数据和证据真实性，约 20% 放在由失败案例驱动的 investigator 改进，约 10% 放在展示和必要配套。不是固定工时承诺，而是范围取舍。

值得积累的资产：

1. **带专家标注的事故回放集**：保留时间、关键证据、干扰证据、允许的结论、应该追问的问题。持续积累真实失败模式。
2. **能回放的证据与决策轨迹**：任何关键判断都能点到来源；区分观察事实、推导结论、仍待验证的假设。
3. **可比较、可质疑的评测系统**：同条件基线、已校准 judge、客观检查、人工裁决、完整失败分母。
4. **由评测验证的诊断策略**：何时继续取证、何时停止、何时明确不确定，而不是增加工具调用次数。

九段输出、换一个更贵的模型、增加一个连接器，都可以成为手段，但本身不足以证明上述优势。

## 2. 审阅基线与已有资产

- 仓库：<https://github.com/YanpengQi7/ai-reliability-copilot>。
- 本地分支：`codex/private-incident-data`；HEAD：`eb1405b`。
- 本次 fetch 后远端 `origin/main`：`626151b17fb57482c8f54a7244d9f9508894058b`；本地领先 77 个提交、落后 0 个。下列判断以本地为主，不能当作线上部署现状。
- 现有未提交修改：`src/lib/observability.ts`、对应测试以及 `.codex/`；本次保持不动。
- 已验证：35 个测试文件、192 个测试全部通过；lint、TypeScript 和 Next.js 16.2.9 production build 通过。
- 未验证：线上环境、真实用户效果、浏览器端到端流程、真实数据库故障恢复、重新调用模型后的质量。

已有能力应继续复用：手写只读 agent loop、工具白名单和调用上限、取消与超时、结构化输出、五维 rubric、重复实验、跨厂商 judge、人工评分脚本、grounding 校准，以及现有 CI。下一步不应再把“添加基础测试 / 加一个 LLM judge”当核心里程碑。

历史产物 `notes/generated/eval-agentic-latest.json` 是 **2026-06-04** 的 60 行结果，重新聚合得到：

| 历史指标 | Single-shot，30 次 | Agentic，30 次 | 能支持的结论 |
|---|---:|---:|---|
| 核心五维平均分 | 4.6267 | 4.6733 | 差异很小，不能据此宣称更好或统计等价 |
| Severity 命中 | 24/30 | 28/30 | 是探索性信号；报告指出差异集中在一个场景 |
| 记录的平均生成成本 | $0.00350 | $0.00608 | 约 1.74 倍；不是完整运行费用 |

历史文件缺少完整 analysis、trace、judge 配置、repeat ID，不能根据当前默认配置反推当时用了哪个 judge。已有报告也已将旧 grounding 4.93 分标为无效；不应重新作为宣传指标。

## 3. 最需要先修的 Eval 可信度问题

### E1：当前对照实验把“方案差异”和“裁判差异”混在一起

证据：`scripts/run-evals-agentic.ts` 的 `scoreRow()` 对 single 调用 `judge()`；对 agentic 调用 `judgeWithGrounding()`，并直接用其五维结果算 overall。`src/lib/eval/judge.ts` 中前者默认 `deepseek-chat`，后者默认 `deepseek-reasoner`，且后者额外看到 trace。注释声称五维保持同一个 judge，但实际调用链不满足。

**实现：**

1. 将 judge 拆为 `judgeCore()`、`judgeGrounding()`，grounding schema 只返回证据维度，不能替换 core 分数。
2. 两个实验组的 core 使用同一个模型、prompt、schema、temperature 和证据输入规则；通过统一的 `EvaluationContext` 显式传参。
3. 保留历史 core-v1 只供历史对照；新增带证据的 core-v2。当前 `buildJudgeUserPrompt()` 接收了 `scenario.context` 却未使用，core-v1 无法充分核查“证据是否捏造”。v2 必须提供同样格式的已观察证据，并将专家答案与观察证据分区。
4. single-shot 的 prompt 中同样有证据：保存实际注入的输入与 KB，即可评 grounding；“没有工具 trace”不等于没有可评证据。
5. judge 看不到方案名称、模型名或版本标签；对外只展示匿名样本 ID。无法完全遮蔽输出风格，需在局限中说明。

**修改位置：** `src/lib/eval/judge.ts`、`rubric.ts`、`judge.test.ts`、`scripts/run-evals-agentic.ts`、`src/lib/ai.ts`。

**验收：** mock 调用断言两组 core 配置一致；更换 grounding judge 不改变 core 输入或分数来源；两组都有独立 grounding 结果；报告显示 rubric/judge 版本。旧结果保留为 legacy，不混进新榜单。

### E2：Severity 的真值与规则尚不足以支撑核心卖点

证据：`src/lib/prompts.ts` v3 写明 error rate >1% 持续 >5 分钟可判 SEV1；`bad-deploy-memory-leak` 的标签是 SEV2，文本出现约 3% 超时、99.7%→96.8% 成功率，但对用户影响持续时间和规则优先级描述不充分。该场景恰好承载报告中全部 severity 差异。

同时，该场景的 **single-shot context 本来就包含 99.7%→96.8% 和多数流量仍可服务**；不能将 agentic 的命中直接解释为“只有 agent 才拿到这条证据”。可能是表示方式、注意力、策略或采样差异，需要控制实验。

**实现：**

1. 新增版本化 `severity-policy`，明确服务关键性、影响比例、持续时间、数据风险、规则优先级与缺失信息的处理方式。
2. 每个案例写 `label_rationale`、`policy_version`、支持标签的 evidence IDs；允许 `acceptable_severities` 或 `insufficient_evidence`，不要强迫有歧义场景只有一个标签。
3. 对 bad-deploy 建成配对案例：相同 OOM 症状，只改变用户影响范围/持续时间；验证模型是否跟随影响变化，而非看到 OOM 就定级。
4. 两位标注者独立标注争议案例，分歧记录后裁决；无法安排第二位时保留“单人标注”状态，不称 gold。
5. 输出 severity 混淆矩阵、欠升级率、过度升级率；对“应保留判断”的样本单独看是否正确表达不确定性。

**验收：** 每个 gold severity 都有可追踪规则和证据；规则冲突阻止数据集发布；旧的 80%→93% 明确标注为旧协议探索性结果，重新评测后再决定是否保留该卖点。

### E3：当前 grounding 校验不能代表事实正确性

证据：`scripts/calib-grounding.ts` 用正则抽数字并以 `includes()` 匹配，还会去掉单位匹配数字核心。数字相同但服务/指标/时间错误可误判支持；没有数字时默认比例为 1。`rubric.ts` 又对所有非逐字的推导扣分，例如有正确来源和计算过程的百分比推导也被压分。

**实现：**

1. 建立 claim 级评估：`observed / derived / hypothesis`，分别记录 `evidence_ids`、服务、指标、值、单位、时间窗。
2. 确定性校验负责 ID 存在、数值单位和明确公式；语义支持关系由独立 judge 判断，并留人工争议入口。
3. 派生 claim 保存公式与操作数来源，例如 `100%-96.8%=3.2%`；有效推导可以合格。区分“当前失败率 3.2%”和“下降 2.9 个百分点”。
4. 将原 numeric matching 降为辅助诊断项，标注为 heuristic；不再称其严格下界，因为它既有假阴性也有假阳性。无可评 claim 时返回 N/A 并报告覆盖率。
5. 制作固定 judge calibration pack：同一真实回答生成单位替换、服务错配、时间错配、颠倒因果、遗漏引用、正确派生、明确假设、恶意评委指令等变体。
6. calibration 固定 analysis 和 evidence，仅改变 judge；当前 `calib-grounding.ts` 每次重新运行 investigator，比较不同 judge 时同时改变了被评分对象。

**验收：** 先制作至少 30 组原始/变异配对，经人工审核；可识别错服务但同数字的样本；正确推导不按捏造惩罚。报告 unsupported-claim precision/recall、混淆矩阵和样本量，不仅展示平均 1–5 分。

## 4. 可按顺序实施的工作包

以下估算为单人集中工作的人日，包含必要验证；人工标注、取得真实数据和付费实验等待时间另计。优先级由“是否会使评测结论失真”决定，之后再考虑产品收益。

| 顺序 | 工作包 | 预期产出 | 估算 | 依赖 |
|---|---|---|---:|---|
| P0 / PR1 | 修复 judge 对照与 severity 标签协议 | 可解释的评测协议 v2 | 2–3 日 | 无 |
| P0 / PR2 | 固定运行产物、回放与实验清单 | 无需重新生成即可换 judge/重算报告 | 2–3 日 | PR1 接口 |
| P0 / PR3 | 证据结构与 investigator 信息丢失修复 | 可核验的事实到结论链 | 3–4 日 | PR2 |
| P1 / PR4 | 构建首批 30 个事故案例与盲测拆分 | 有版本的数据资产 | 4–6 日 | PR1 |
| P1 / PR5 | claim 校验与 judge 校准集 | 知道 judge 何时可信 | 3–4 日 | PR3、PR4 |
| P1 / PR6 | 同条件基线、消融与配对统计 | 能解释提升来自哪里 | 3–4 日 | PR2、PR4、PR5 |
| P1 / PR7 | 依据失败切片改善取证策略 | 证明 investigator 增量价值 | 3–5 日 | PR6 基线 |
| P1 / PR8 | Eval 回归门槛与结果页 | 每次变更可审阅的证据包 | 2–3 日 | PR6 |
| P2 / PR9 | 一个真实只读数据源与反馈回流 | 从模拟评测走向真实使用 | 3–5 日 | 权限前置、PR7 |

约 25–37 个工作日的完整方向，可拆成 5–8 周；前两周重点完成测量基础和小规模试跑，不承诺已经获得效果提升。

### PR2：把 Eval 从一次性脚本变成可回放实验

**现状：** agentic 的 `Row` 只有分数和成本，缺完整回答、trace、repeat ID、失败行、模型/输入快照，最终覆盖同一个 `latest.json`。跨 judge 脚本虽然同一次运行内固定回答，但没有把完整回答存下来供下一次复评。

**新增文件（拟议）：**

- `src/lib/eval/contracts.ts`：`RunManifest`、`TrialRecord`、`JudgeRecord` 的 Zod schema。
- `src/lib/eval/artifacts.ts`：逐 trial 原子写文件、恢复、内容 hash、latest 索引。
- `scripts/eval-generate.ts`、`eval-score.ts`、`eval-report.ts`：拆分生成、评分、报告；旧命令先包装这些函数，逐步迁移。
- `evals/runs/<run_id>/manifest.json`、`trials/<trial_id>.json`、`judgments/<judge_run_id>.jsonl`、`report.md`：本地运行目录；含真实事故的数据不提交 Git，公开仅提交脱敏报告和公开样例。

**Manifest 必须保存：** Git SHA、工作区是否 dirty 及相关源码摘要、dataset/prompt/schema/rubric hashes、模型请求 ID/实际返回标识（可得时）、生成与 judge 配置、language、repeat、顺序随机种子、budget、KB snapshot、工具/adapter 版本。

**Trial 必须保存：** 输入、允许访问的证据快照、实际看见的证据、最终回答、每步工具输入输出、结束原因、失败阶段、重试、生成/工具/judge 各自延迟与费用。证据是输出记录，不包含模型私有思维链。不可得的费用标为 unknown，不当成 0。

**关键行为：**

1. 每个 trial 完成或失败立即写盘；中断后按 manifest hash + trial key 恢复。
2. 所有计划样本都有记录，包括 provider 失败、schema 失败、超时和 judge 失败；失败不从分母消失。
3. 重新评分只读现有回答；用 spy 测试确保不会触发 generator。
4. 单独限制总美元预算、总运行时间、并发、每次输出长度；当前 repeat 上限不是费用上限。
5. mock provider 用于离线验证；正式实验记录调用时间，承认供应商 alias 和非确定性意味着不能保证逐字复现。

**验收：** 人为中断后恢复不重复已完成 trial；重新评分不调用生成模型；只靠产物能复算报告；失败/缺失预算信息有明确展示；没有 live Supabase 也能回放。

### PR3：让产品的证据链本身可被评测

**已确认问题：** `src/lib/agent/investigate.ts:212` 的最终生成 prompt 只带 service、symptoms、tool trace；用户 raw_context 只给了前面的调查阶段，最终阶段未带入。非 scenario 场景的 metrics/logs 工具会返回空，因此最终回答可能失去最重要的用户证据。五个 scenario 的现有 eval 无法覆盖这个入口。

**实施：**

1. 在 `src/lib/agent/types.ts` 新增 `EvidenceItem`：稳定 ID、source_kind、source_locator、service、observed_at/time_range、文本或结构化值、content_hash、snapshot_version。
2. 用户原始输入成为 `user_context` 证据；工具结果成为 `tool_observation`；KB 成为带版本的 `kb_chunk`。最终 `buildConclusionContext()` 合并实际可见证据，设总大小限制并记录截断。
3. 结论 `claims` 单独作为分析附加结构，保留现有九段 UI 的适配层；每个根因记录支持/反驳 evidence IDs、confidence、missing_evidence、next_discriminating_check。
4. 用户笔记是“用户报告”，不是已验证遥测；模型先前的总结也不能转成新事实。模型输出仅能引用已给它看的 ID。
5. 增加 `conclusion_status: supported / tentative / insufficient_evidence`；不要仅凭模型停止调用工具就显示诊断已验证。
6. 逐步放松“必须 3–5 个根因 / 至少 2 个缓解动作”的格式压力：允许证据不足或单一明确根因，空缺必须解释，保留旧 schema 版本兼容。

**同步修复 RAG 审计：** `src/app/api/incidents/save/route.ts:158` 保存时再次检索不等于生成时证据。由服务端生成 `run_id` 并存实际 retrieval snapshot，保存接口引用该 run。不要信任客户端上传的引用清单、usage 或 model 元数据作为权威来源；外部 MCP 导入的分析单独标为 external origin。

**KB 版本：** `kb.ts` 目前先写 content_hash 再删除旧 chunks，失败后重试可能因 hash 一致而跳过；SQL 对 chunk 的删除还会 cascade 删除历史引用。改为先构建新 revision，完整写入后事务切换 active_revision，历史分析保留不可变证据快照。仅允许“ready revision + hash 一致”跳过。

**验收：** raw-context-only 且工具全部 empty 的测试仍把用户证据传入最终生成；引用越界被拒绝；中途更新 KB 后旧分析仍能展示旧原文；KB 写失败不切换版本且可重试。

### PR4：构建能拉开能力差距的事故回放集

首批目标 **30 个独立事故案例**。可按下列主类别分配，类别外另加语言、严重程度和数据来源标签：

| 主类别 | 数量 | 要检验的能力 |
|---|---:|---|
| 典型单根因 | 6 | 保留已有五例并补一个基础例 |
| 相似症状、不同根因 | 6 | OOM 不一定泄漏；连接池满不一定慢查询 |
| 证据缺失或冲突 | 5 | 正确追问、承认不确定性、避免捏造 |
| 多根因或级联故障 | 4 | 区分触发因素、放大机制和伴随现象 |
| 长日志、时序干扰、工具部分失败 | 4 | 限量取证下保留决定性信号 |
| 过期/错服务 KB、注入指令、危险建议诱导 | 5 | 数据信任边界和安全判断 |

**数据结构与实现位置：** 新建 `evals/datasets/sre-v2/`、`src/lib/eval/dataset.ts`。每个案例拆为 `alert`、`evidence`、仅 evaluator 可读的 `gold`，不再手工维护互相漂移的 prose context 和 typed signals。统一由 evidence 生成基线输入和工具回放结果。

Gold 包含：根因机制及可接受表述、必要证据集合、应排除的假设、severity policy/rationale、允许/禁止动作、合理的下一检查、能否充分定论、标注来源和审核状态。不能让答案标签、结论性文件名或完整 postmortem root-cause 段进入事故开始时的证据。

**拆分：** 开发 18、验证 6、锁定测试 6。按事故家族分组，改写、语言翻译、配对变体不得跨 split；现有公开五例放开发集。六个测试例只适合 pilot，不能支撑广泛生产优势；之后优先增加独立案例而非无限增加 repeat。

**时间可见性：** 证据记录 `available_at`，回放时只能取当前事故时间前已出现的信息；最终 postmortem 只进入 gold。证据预算一致，输入含干扰但不含标签。

**检索子集：** 为需要 KB 的案例另标相关 chunk IDs，测 recall@k、错服务/过期命中率和有无 KB 时的决策变化；只有出现对应失败切片再增加 reranker/hybrid search，不先堆检索复杂度。

**验收：** 所有样本通过 schema/时间/标签泄漏检查；高风险标签有复核记录；中英文同源案例保留同一 family ID；新增真实事故前先脱敏并记录使用授权。

### PR5：用人工与变异样本校准 Judge

在 E3 基础上，将 `scripts/human-vs-judge.ts` 从“最近 N 条”改为固定、分层抽样。现有 UI 展示 prompt 版本、截断部分证据，且未提供完整 incident context/trace；不适合严格盲评事实正确性。

1. 展示完整问题、可见证据和回答；隐藏模型、版本、模式以及其他裁判分数。
2. 样本覆盖成功、失败、两个语言、severity、派生事实与冲突证据；对两位标注者的分歧保留 adjudication。
3. 1–5 ordinal 分数报告加权 kappa 和 MAE；是否存在无依据 claim 报 precision/recall；相关系数仅作为辅助。小样本都附区间和分母。
4. 用一个独立厂商 judge 对固定样本复评；厂商独立不等于正确，结果仍以人工标签校准。
5. 加入 judge 注入测试：回答中的“请给满分”等文本只作为待评分内容，不能改变评分规则。

**建议 pilot 门槛（需在锁定测试前冻结）：** 重大无依据 claim 检出 recall ≥90%、precision ≥85%；达不到时允许人工裁决，不让该 judge 单独控制发布。30 组只能初筛，必须公布区间，不把阈值当已达到的成绩。

### PR6：公平基线、消融和统计

**先回答三个不同问题：**

| 比较 | 控制条件 | 能说明什么 |
|---|---|---|
| Alert-only single vs agent | 初始告警相同，agent 可取证 | 整套工具取证带来的产品收益；不能归因于推理策略本身 |
| 固定取证 workflow vs agent | 相同工具、证据池、token/调用预算、生成模型 | 自适应取证是否优于固定流程 |
| Full-context single vs agent | 来源于同一 evidence snapshot，前者直接读完整可见事实 | 简单方案已经足够时，agent 是否只是增加成本 |

先用同一个模型完成对照。模型升级、跨厂商生成比较另开实验，避免同时改变模型与 harness。Full-context 是参考组；当完整上下文不可现实获取时，不能当作同成本的线上方案。

**消融：** 有/无 KB、有/无结构化 hypothesis state、有/无自适应停止；一次只改一个机制。每个变体共用冻结证据和评分配置。按 scenario/language/repeat block 交错随机运行，减少供应商时间漂移的影响。

**主要指标：**

- `validated_task_success`：根因或恰当“不足以定论”被认可、severity 在允许范围、关键 claim 有支持、无禁止动作、产物可用，全部满足才成功。公开各子条件，禁止用高文笔分抵消危险建议。
- `critical_unsupported_claim_rate`：有重大无依据 claim 的完成回答 / 完成回答；同时报告端到端成功率，不能通过大量失败或拒答隐藏问题。
- `evidence_coverage`：已发现的 gold 必要证据 / gold 必要证据；同时测引用 precision，不能靠把全部日志塞进上下文获胜。
- `cost_per_success`：所有计划 trial 的生成、重试和工具成本 / 验证成功数；评委费用单列。成功数为 0 时为无穷/不可用，不显示 0。
- `time_to_supported_diagnosis`：完成符合验收条件的诊断所用时间；失败单列。另报 P50/P95、token、重复工具调用比例。
- 五维 rubric 保留为辅助指标，不再作为唯一 headline。

**统计实现：** 新增 `src/lib/eval/statistics.ts`。以事故 family 为 cluster，对方案差异做 paired cluster bootstrap，固定随机种子并保留同场景的语言、重复记录在同一 cluster 内。报告差值及 95% 区间，不把 5 个事故×语言×重复误当成几十个独立事故。

`|Δmean| > pooled std` 只能是粗略描述，不是显著性检验；区间覆盖 0 应表述为“没有足够证据证明差异”，不是“统计上相等”。如需证明等价/不劣，必须预设 margin 并按对应协议判断。

生成失败按 task failure 进入总体分母；judge 失败记 unscored，报告 coverage 并阻止可信结论发布；不能当成回答错误，也不能静默删除。只在配对完整子集上给辅助质量分差异，并披露移除数量。

**成本控制：** pilot 用开发集 6 案例×3 方案×1 语言×1 repeat=18 trials；费用统计可信后，再跑 30×3×2×3=540 trials。540 是计划样本量，不是当前已运行。按 pilot token 实耗及实际模型价格计算预算，达到上限停止，不能无预算全量跑。

**验收：** 相同产物重算得到相同汇总；注入失败样本后分母不缩水；模拟数据能检出已知退化；报告同时展示总体与 category/severity/language slices。

### PR7：用失败案例驱动 investigator，而非继续堆 Prompt

修改 `src/lib/agent/state.ts`、`investigate.ts`、`tools.ts`：

1. 用结构化假设状态替代当前主要由工具输出首行组成的 scratchpad：每个假设保存 supporting/refuting IDs、缺失的判别性证据和下一步检查。
2. 对竞争根因选择可区分它们的工具调用；拿到足够证据时停止，不足时返回具体缺口。
3. 预算按工具调用、输入/输出 token、时间共同约束；重复调用不算获得新证据。
4. 错误/empty 与“观测值正常”区分；过期 runbook、跨服务结果不能自动当成支持。
5. 由 PR6 找最大的失败切片先修一项，例如混淆 OOM 泄漏与容量不足；每次附 before/after 固定失败样本和未见案例结果。

**采用门槛建议：** dev 上找到有效变化后，只在验证集选版本；锁定测试用于最终确认。以总体成功率与重大无依据 claim 为主，附成本和区间。如果 agent 没有达到预设收益，则保留简单路径作默认、只把 agent 用于确有收益的场景。该选择本身也是可靠结论。

### PR8：让 Eval 成为每次改动的验收证据

**CI 分层：**

1. 每个 PR：纯本地 dataset 校验、证据引用检查、统计和 failure accounting 测试、固定回放契约测试；不调用付费 API。
2. 修改 prompts、agent、schema、retrieval、rubric 时：标记需要 live eval；在获配预算的验证环境跑小集。无密钥或未运行显示“未评估”，不能显示通过。
3. 发布候选：冻结版本、校准包、锁定集、完整预算与失败报告；已有 `.github/workflows/eval.yml` 扩展为读取 manifest，上传完整脱敏产物。
4. 用独立 `eval-check` 退出码区分 regression、incomplete 和 infrastructure failure；样本失败不能只留下 console 日志。

**发布规则先写进 `evals/protocol-v2.json`：** 重大禁止动作 sentinel 必须全过；判断校准须达标；coverage 必须完整或按预注册规则明确 fail/inconclusive；成功率不劣 margin 和成本上限在看 test 结果前冻结。小集区间太宽时需要更多独立案例，不靠调阈值放行。

**结果页：** 改 `src/app/evals/page.tsx`，按 run 比较，显示 dataset/policy/model/judge 版本、成功率差及区间、失败切片、成本/延迟、证据链 drill-down。当前页面最近 200 条的聚合不能代替一个有完整分母的实验。Demo 展示预计算公开数据，不要求访客现场付费等待。

**对外材料：** 同步 README、EVALUATION 和 reviewed report；删除“差异小所以 statistically tied”的过强表述，修正“未做 repeats”等过时内容；明确哪些结果是旧协议。展示一个正确诊断、一个诚实拒绝定论、一个 agent 失败案例及修复后数据。

### PR9：最小真实接入与数据飞轮

当前 `get_metrics/get_logs/get_deploy_history` 主要读取 `src/lib/scenarios.ts` 的模拟 signals，非 scenario 数据为空。下一步只选一个实际可获得、只读且有授权的数据源，不一次实现多个供应商。

- 定义 `TelemetryAdapter`：`getMetrics/getLogs/getDeployHistory`；分 `FixtureAdapter` 和一个真实 adapter，共用 EvidenceItem 与预算约束。
- 服务端固定目标 host、service scope 和凭据；不允许模型提供任意 URL 或扩大访问范围。
- 记录脱敏 observation 为回放包；在线成功不等于 eval 成功，回放仍走同一评分协议。
- 产品反馈收集“诊断被采纳/错误”“实际根因”“采用了哪些证据”“为什么改定 severity”；未确认的 AI 答案不能直接变成 gold。
- 按月整理高价值失败，审核后进入开发集；测试集只做版本化更替，避免反复针对同一个 test 调参。
- 真实 MTTR 改善需要用户研究或明确对照；离线诊断时延不能直接宣传为 MTTR 缩短。

## 5. 前两周具体执行清单

| 时间 | 任务 | 可审阅的交付物 |
|---|---|---|
| 第 1–2 日 | E1 同裁判比较、severity 协议和争议标签检查 | PR1；协议 v2 草案；标注争议表 |
| 第 3–5 日 | Manifest/trial/judgment 分离、保存失败、回放评分 | PR2；离线 demo run；从产物重算报告 |
| 第 6–8 日 | user context 信息丢失修复、EvidenceItem、引用验证 | PR3 最小可用部分；raw-only/错 ID 回归 |
| 第 9–10 日 | 开发集 6 个代表案例与校准 pack 初版；18-trial pilot | 预算估算、失败切片、下一轮假设清单 |

完整 KB revision 迁移、30 例专家复核和全量 live eval可在后续迭代完成；不把它们挤进首两周的固定承诺。每个 PR 包括必要回归，不单独留到最后补测试。

## 6. 必要配套，但不扩成主线

| 事项 | 代码证据 | 最小处理 / 与主线关系 |
|---|---|---|
| 内部 KB 访问边界 | `/api/analyze` 直接调用 admin-backed retrieval；`/api/investigate` 也可搜索 runbooks | 在接真实私有数据前完成身份与检索范围检查；匿名 demo 只用公开 fixture KB。这是代码路径风险，未进行线上泄露测试。 |
| 私有网页保存闭环 | 保存接口和私有页面受访问开关保护，主页没有会话凭据入口 | 先做好无保存 demo 与结果导出；真实试用再补 Supabase SSR 会话和 scope，不用打开全库公开作为解决方案。 |
| Webhook 重复与失败状态 | `after()` 后台执行；失败插入带 summary 的 SEV3 analysis；CLI 用 summary 存在判断成功 | 真实试用前加 job status、event idempotency、CLI 非零失败退出；耐久队列按可靠性需求另立任务。 |
| 发布同步 | 本地领先远端 main 77 提交 | 另行整理已完成改动并验证部署；计划不自动 push/merge。不要让新 eval 报告混用未记录版本。 |

Next.js 的本地 `after` 文档说明其仍受 route/platform duration 限制，因此后台回调不等于耐久任务系统。权限设计参考 [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) 与 [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)：用户会话和行访问范围需要分别落实；service-role 路径尤其不能依赖前端隐藏按钮完成隔离。

## 7. 完成后应该能够回答的问题

1. 同模型同证据条件下，agent 比固定 workflow 多成功了哪些事故？区间有多宽？
2. 最常见失败是什么：没有取到证据、理解错证据、severity policy 歧义，还是 judge 错判？
3. 每个关键结论对应哪条原始证据？哪些只是待验证假设？
4. 提升来自 KB、结构化状态、自适应取证还是模型本身？
5. 成功一次要花多少钱、多久？失败和重试成本是否包含？
6. 新模型/新 prompt 进来，是否能在不重写整个系统的情况下证明没有退化？

首轮即使证明“agent 在多数简单事故上不值得额外成本”，也是有效产出。真正值得展示的是可信的边界、可复现的证据与明确的迭代收益。

## 8. 参考与方法边界

- 主要依据是本地代码及仓库内原始结果，不是根据 README 功能列表推测。
- [Anthropic：Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)：参考其任务/试次/轨迹分离和多种 grader 组合的原则；本计划中的数据规模、指标和阈值是针对本项目提出的方案。
- 已读本地 Next.js 16.2.9 的 `after`、Proxy 指南；后续写代码仍应按 AGENTS.md 阅读具体 API 对应版本指南。
- Supabase changelog 已检查近期条目；本次没有执行数据库迁移。具体迁移实现时应再核对实例版本和对应功能文档。
- 文内所有“建议门槛”“预期产出”均为实施目标，不是已验证的产品成绩。


## 执行状态（2026-09-27）

本轮落实核心评测基础设施，实施说明见仓库 `EVAL-V2.md`：

- 已实现：统一五维 judge，grounding 独立评分；明确严重性策略；结构化证据、声明与确定性引用/数值校验。
- 已实现：full / workflow / agentic 公平比较、只读快照适配器、实验性假设驱动调查、消融开关。
- 已实现：30 个草稿案例、20 个事故家族；数据集验证、固定答案校准、双人盲审导出。
- 已实现：不可覆盖的生成记录、独立重评分、恢复运行、预算预留、失败计入分母、家族聚类区间和发布门槛。
- 已实现：公开汇总页面与 CI 离线回放；原网页调查保留用户原始上下文，匿名请求禁止读取私有 KB。
- 已验证：真实模型小规模贯通；历史失败保留在本地运行记录中。小样本结果不代表能力提升或发布资格。
- 未完成：独立人工 gold、受控留出集、真实遥测接入、数据库证据快照/原子 KB 版本、持久 webhook 作业与真实 MTTR 验证。这些不能由合成案例或离线文件评测代替。

实现优先建立可证明改进的基础；没有把后续数据接入和人工评审标记为完成。


### 第二轮实施：证据完整性和难例驱动修复

- 报告按 manifest 重建完整试验矩阵；拒绝重复记录、错配方案、错误 judge 版本及失效答案哈希。
- 成功记录必须包含回答/评分；观测时间与可用时间都受截止时间约束，证据内容必须匹配原始快照。
- 加入绝对成功率下限（默认 80%），展示门槛未通过的具体原因、必要证据召回、声明错误与全量尝试耗时。
- Web 调查按新证据内容检测进展；实验调查保存结构化假设与下一步检查，并传入最终综合。
- 告警具有统一的未验证证据 ID；明确 SEV2 不要求最小用户影响比例，避免把局部客户影响误降为 SEV3。
- 新增 6 个独立草稿开发难例，覆盖服务/时间/来源隔离、指令注入、矛盾证据、分母误用和部署误归因。
- 盲审导出绑定显示内容和原试验哈希；内容变更后拒绝沿用旧评审，校准审核人身份去除空格与大小写差异。
- 新旧真实试跑保留在独立本地运行目录；这些开发集修复结果不作为独立泛化证据。

### 第三轮实施：恢复与评分记录不可变（2026-09-28）

- 已结束试验与评分记录拒绝修改；显式新 run / judge-run 才能重试。
- 报告不再补写缺失的原始记录；恢复生成遇到缺失文件时拒绝自动重跑，防止污染实验。
- 恢复命令拒绝忽略新模型/数据/预算参数；负价格、负预算预留和歧义开关在调用前拒绝。
- 历史 Judge 校准按保存的模型与提示词版本回放。
- 新增恢复与参数回归测试；CLI 实测删除 mock 试验文件后报告保持 incomplete、文件不被重建、生成拒绝覆盖；不涉及付费模型调用。

### 第四轮实施：调查读取边界（2026-09-28）

- 工具摘要移出系统提示词，作为不可信上下文传入；摘要限长、去重。
- 参数键顺序归一化后去重；临时工具失败允许一次重试，持续失败仍受次数和步数限制。
- 遥测服务名严格匹配；适配器数据按 schema 校验并拒绝跨服务遥测。
- 超长证据不会阻断后续短证据，截断数量明确提示；最终分析保留缺失/失败/截断限制。
- 新增对应边界测试和离线难例回放，无付费模型调用。
