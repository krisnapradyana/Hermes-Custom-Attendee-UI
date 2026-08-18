/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Served behind Caddy at https://<domain>/clock — same domain as the main
  // assistant app, so one cert and one Slack app cover both.
  basePath: "/clock",
  // Slim self-contained server bundle for Docker deployment.
  output: "standalone",
};

export default nextConfig;
