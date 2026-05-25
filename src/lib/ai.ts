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
