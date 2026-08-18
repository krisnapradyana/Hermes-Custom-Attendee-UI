/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Served on its OWN subdomain (clock.<domain>) — DuckDNS resolves every
  // sub-subdomain to the same IP, Caddy routes by hostname. No basePath.
  // Slim self-contained server bundle for Docker deployment.
  output: "standalone",
};

export default nextConfig;
