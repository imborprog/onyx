import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/w/", "/api/", "/support/", "/checkout"] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
