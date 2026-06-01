import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 是 native 模块，不能被 turbopack bundle 进 server chunks
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    // chrome-extension:// 页面（sidepanel 等）的 fetch 受 CORS 约束，dev 和 prod 都要发头，
    // 否则生产报 "No Access-Control-Allow-Origin"。只针对 /api/* 放开。
    // 当前用 *（无 cookie、无 credentials，安全）。后续要收紧可改成回显 chrome-extension:// 来源
    // 或加鉴权——见 docs/deploy-vps.md。可用 CORS_ALLOW_ORIGIN 覆盖。
    const allowOrigin = process.env.CORS_ALLOW_ORIGIN || '*';
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
