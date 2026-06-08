import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { describeImage, hasVisionProvider } from "@/lib/vision";
import { apiError, validationError, invalidJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  image: z.string().min(20), // either data URL or public https URL
});

export async function POST(req: NextRequest) {
  if (!hasVisionProvider()) {
    return apiError(503, "MISSING_API_KEY", "OPENAI_API_KEY required for image analysis");
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return invalidJson();
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const description = await describeImage(parsed.data.image);
  if (!description) return apiError(502, "VISION_FAILED", "Vision call returned no content");
  return NextResponse.json({ description });
}
