const nextConfig = {
  experimental: {
    proxyTimeout: 180000,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8002/api/:path*" },
      { source: "/ws/:path*", destination: "http://127.0.0.1:8002/ws/:path*" },
    ];
  },
};
module.exports = nextConfig;
