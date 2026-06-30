const backendHost = process.env.FLOWFORGE_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.FLOWFORGE_BACKEND_PORT || "8000";
const backendUrl = `http://${backendHost}:${backendPort}`;

const nextConfig = {
  experimental: {
    proxyTimeout: 180000,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/ws/:path*", destination: `${backendUrl}/ws/:path*` },
    ];
  },
};
module.exports = nextConfig;
