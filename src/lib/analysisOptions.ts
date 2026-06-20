import { DEFAULT_PROMPT_VERSION, type OutputLanguage, type PromptVersion } from "./prompts";

export type AnalysisOptionsResult =
  | { ok: true; version: PromptVersion; language: OutputLanguage }
  | { ok: false; message: string };

export function parseAnalysisOptions(searchParams: URLSearchParams): AnalysisOptionsResult {
  const requestedVersion = searchParams.get("version");
  if (requestedVersion !== null && requestedVersion !== "v1" && requestedVersion !== "v2" && requestedVersion !== "v3") {
    return { ok: false, message: 'version must be one of "v1", "v2", or "v3".' };
  }

  const requestedLanguage = searchParams.get("language");
  if (requestedLanguage !== null && requestedLanguage !== "en" && requestedLanguage !== "zh") {
    return { ok: false, message: 'language must be either "en" or "zh".' };
  }

  return {
    ok: true,
    version: requestedVersion ?? DEFAULT_PROMPT_VERSION,
    language: requestedLanguage ?? "en",
  };
}
