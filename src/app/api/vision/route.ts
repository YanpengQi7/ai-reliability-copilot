import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { describeImage, hasVisionProvider } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  image: z.string().min(20), // either data URL or public https URL
});

export async function POST(req: NextRequest) {
  if (!hasVisionProvider()) {
    return NextResponse.json({ error: "MISSING_API_KEY", message: "OPENAI_API_KEY required for image analysis", statusCode: 503 }, { status: 503 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body must be JSON", statusCode: 400 }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: parsed.error.message, statusCode: 400 }, { status: 400 });

  const description = await describeImage(parsed.data.image);
  if (!description) return NextResponse.json({ error: "VISION_FAILED", message: "Vision call returned no content", statusCode: 502 }, { status: 502 });
  return NextResponse.json({ description });
}
