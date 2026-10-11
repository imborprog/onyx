import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/**": ["./db/migrations/*.sql"],
  },
};

export default nextConfig;
