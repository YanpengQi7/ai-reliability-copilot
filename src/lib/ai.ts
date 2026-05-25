import { createDeepSeek } from "@ai-sdk/deepseek";

const apiKey = process.env.DEEPSEEK_API_KEY;

export const deepseek = createDeepSeek({
  apiKey: apiKey ?? "",
});

// Default model for analysis. DeepSeek-chat is the general-purpose model;
// switch to "deepseek-reasoner" for tougher cases (will be a knob in Week 3).
export const ANALYSIS_MODEL = "deepseek-chat";
export const JUDGE_MODEL = "deepseek-chat";
