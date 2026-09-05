// PWA：@ducanh2912/next-pwa 在构建期生成 Service Worker（dest: 'public'）
// 参考clowder-ai：dynamicStartUrl:false 预缓存 Start URL，实现冷启动秒开
const withPWA = require("@ducanh2912/next-pwa").default;

// dev 环境默认禁用 PWA（避免 HMR 与 SW 缓存冲突），可用 ENABLE_PWA_IN_DEV=1 强制开启
const enablePwaInDev = process.env.ENABLE_PWA_IN_DEV === "1";

const backendHost = process.env.FLOWFORGE_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.FLOWFORGE_BACKEND_PORT || "8000";
const backendUrl = `http://${backendHost}:${backendPort}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 性能优化：React 严格模式（开发期检测潜在问题，生产无运行时开销）
  reactStrictMode: true,

  // 性能优化：隐藏 X-Powered-By 头，减少信息泄漏
  poweredByHeader: false,

  // D28：monorepo 共享源码包经 file: 依赖 + transpile 编译同一份 TS
  transpilePackages: ["@flowforge/config-schema"],

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

module.exports = withPWA({
  // SW 产物输出到 public/sw.js（next-pwa 默认）
  dest: "public",
  // dev 环境禁用 PWA，避免 SW 缓存干扰 HMR
  disable: process.env.NODE_ENV === "development" && !enablePwaInDev,
  // Start URL 为静态外壳，预缓存后 PWA 冷启动不阻塞网络
  dynamicStartUrl: false,
  // 离线恢复联网后不自动刷新（避免打断用户操作，由业务层自行处理刷新）
  reloadOnOnline: false,
  // 复用 next-pwa 默认页面/文档运行时缓存，仅覆盖需要自定义的部分
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    // 忽略 utm_/fbclid 等追踪参数，避免污染缓存键
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
    runtimeCaching: [
      {
        // API 调用：绝不缓存，始终拉取最新数据
        urlPattern: /^https?:\/\/.*\/api\//,
        handler: "NetworkOnly",
      },
      {
        // WebSocket 升级请求：跳过缓存
        urlPattern: /^https?:\/\/.*\/ws\//,
        handler: "NetworkOnly",
      },
      {
        // 静态资源：CacheFirst 提升性能（图标/字体/图片）
        urlPattern: /\.(png|jpg|jpeg|svg|gif|ico|woff2?)$/,
        handler: "CacheFirst",
        options: {
          cacheName: "flowforge-static-assets",
          expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  },
})(nextConfig);
