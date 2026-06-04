import { createDeepSeek, type DeepSeekProvider } from "@ai-sdk/deepseek";

// Deferred init — do NOT capture process.env at module load.
// In Next.js routes, env vars are loaded before route execution.
// In tsx scripts, dotenv runs AFTER ES-module imports are hoisted, so we
// must read process.env lazily inside the provider factory.
let _deepseek: DeepSeekProvider | null = null;
function getProvider(): DeepSeekProvider {
  if (_deepseek) return _deepseek;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  _deepseek = createDeepSeek({ apiKey: apiKey ?? "" });
  return _deepseek;
}

// Plain function wrapper. ES-module callers do `deepseek(modelId)` — this
// resolves the provider on first call.
export function deepseek(modelId: string) {
  return getProvider()(modelId);
}

export const ANALYSIS_MODEL = "deepseek-chat";
export const JUDGE_MODEL = "deepseek-chat";
// Grounding is graded by a stronger (reasoning) judge. Calibration showed
// deepseek-chat returns a flat 5.00 with zero variance on evidence_grounding —
// it can't discriminate verbatim-grounded from derived claims even with tightened
// anchors. deepseek-reasoner produces real variance that tracks the deterministic
// grounded-ratio check. See notes/calib-grounding-findings.md. The core-5 eval
// keeps JUDGE_MODEL for comparability with the historical single-shot evals.
export const JUDGE_MODEL_GROUNDING = "deepseek-reasoner";
