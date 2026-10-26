import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Native / heavy conversion engines must stay outside the bundler
  serverExternalPackages: [
    "sharp",
    "playwright-core",
    "adm-zip",
    "archiver",
    "xlsx",
    "docx",
    "mammoth",
    "pdfjs-dist",
    "pdf-lib",
  ],
};

export default nextConfig;
