// Image → description, used to enrich raw_context when the user attaches a screenshot
// (Grafana dashboard, error page, alert UI, traceback screenshot, etc.)
//
// Backend: OpenAI gpt-4o-mini (vision-capable, ~$0.15 per image). Chosen over GPT-4 Vision
// because we want short factual descriptions, not creative captions.
//
// We deliberately do NOT use DeepSeek-VL2: AI SDK doesn't have a stable adapter for it
// at time of writing, and the prompt steering for SRE-specific image content is much
// better tested on OpenAI.

import OpenAI from "openai";

const VISION_MODEL = "gpt-4o-mini";

let _client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function hasVisionProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT = `You are describing a screenshot for a Site Reliability Engineer responding to an incident.

Extract everything operationally relevant:
- Names of services, dashboards, metrics, log fields visible
- Timestamps and time ranges (mention UTC or whatever is shown)
- Numeric values, thresholds, anomalies (spikes / drops / flat lines)
- Error messages or stack traces (transcribe verbatim if short, summarize if long)
- Alert names / severities / panel titles
- Visible deploy markers, annotations, or links

Format: concise markdown bullet list. No marketing language. No introductions like "This image shows...". Just facts.

If the image is not operationally useful (random photo, unrelated UI), say so in one line.`;

/**
 * Describe an image. The `image` is either a public URL, or a data URL (base64).
 * Returns null when no vision provider is configured.
 */
export async function describeImage(image: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this screenshot." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 700,
      temperature: 0,
    });
    return res.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.error("[vision] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
