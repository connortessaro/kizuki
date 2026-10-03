import type { NextConfig } from "next"

// kizuki.dev is plain files: `next build` writes them to out/, and Vercel serves them.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
}

export default nextConfig
