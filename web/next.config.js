const backendHost = process.env.FLOWFORGE_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.FLOWFORGE_BACKEND_PORT || "8000";
const backendUrl = `http://${backendHost}:${backendPort}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 性能优化：React 严格模式（开发期检测潜在问题，生产无运行时开销）
  reactStrictMode: true,

  // 性能优化：隐藏 X-Powered-By 头，减少信息泄漏
  poweredByHeader: false,

  // 性能优化：生产环境移除 console（保留 error）
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error"] }
      : false,
  },

  experimental: {
    // 后端代理超时（与原配置保持一致）
    proxyTimeout: 180000,
    // 性能优化：启用 optimizePackageImports 优化大库的按需导入
    // 对 lucide-react 等图标库特别有效，避免全量打包
    optimizePackageImports: [
      "lucide-react",
      "@xyflow/react",
      "react-markdown",
    ],
  },

  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/ws/:path*", destination: `${backendUrl}/ws/:path*` },
    ];
  },
};

module.exports = nextConfig;
