import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/vanita-stock-review/[[...asset]]": ["./projects/vanita-stock/**/*"],
  },
};

export default nextConfig;
