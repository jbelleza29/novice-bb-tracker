import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Production builds to static files that the Go server embeds and serves.
// In dev, /api is proxied to the Go server so cookies stay same-origin.
const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${process.env.NBT_API_URL ?? "http://localhost:8080"}/api/:path*` }];
      },
    }
  : { output: "export" };

export default nextConfig;
