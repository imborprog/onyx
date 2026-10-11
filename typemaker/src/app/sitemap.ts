import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";
import { galleryTests } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const fixed = ["", "/gallery", "/pricing", "/create", "/contact"].map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 }));
  let tests: MetadataRoute.Sitemap = [];
  try {
    tests = (await galleryTests(500)).map((t) => ({ url: `${base}/t/${t.slug}`, changeFrequency: "weekly" as const, priority: 0.6 }));
  } catch {
    tests = [];
  }
  return [...fixed, ...tests];
}
