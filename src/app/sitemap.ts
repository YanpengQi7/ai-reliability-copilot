import type { MetadataRoute } from "next";
import { resolveAppBaseUrl } from "@/lib/appUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = new URL(`${resolveAppBaseUrl()}/`);

  return ["", "scenarios", "evals/benchmark"].map((path) => ({
    url: new URL(path, baseUrl).toString(),
  }));
}
