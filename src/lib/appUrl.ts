const DEFAULT_APP_URL = "https://ai-reliability-copilot.vercel.app";

function normalizeHttpBase(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export function resolveAppBaseUrl(requestUrl?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
    ? normalizeHttpBase(process.env.NEXT_PUBLIC_APP_URL)
    : null;
  if (configured) return configured;

  const requestBase = requestUrl ? normalizeHttpBase(requestUrl) : null;
  return requestBase ? new URL(requestBase).origin : DEFAULT_APP_URL;
}
