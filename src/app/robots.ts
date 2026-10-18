import type { MetadataRoute } from "next";
import { resolveAppBaseUrl } from "@/lib/appUrl";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = new URL(`${resolveAppBaseUrl()}/`);

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/scenarios", "/evals/benchmark"],
      disallow: ["/api/", "/incidents", "/kb", "/evals", "/mcp-usage"],
    },
    sitemap: new URL("sitemap.xml", baseUrl).toString(),
  };
}
