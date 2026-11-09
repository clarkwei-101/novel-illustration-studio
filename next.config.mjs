/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages ship native or worker-based code that must not be bundled
  // by webpack — they are loaded at runtime instead.
  serverExternalPackages: ["pdf-parse", "mammoth", "jszip", "chardet"],
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
