/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages ship native or worker-based code that must not be bundled
  // by webpack — they are loaded at runtime instead.
  // `@node-rs/jieba` is a Rust N-API module used by the server-side
  // keyword extractor; bundling it breaks the build.
  serverExternalPackages: [
    "pdf-parse",
    "mammoth",
    "jszip",
    "chardet",
    "@node-rs/jieba",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
