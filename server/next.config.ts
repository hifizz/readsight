import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    // Side Panel 通过 bearer token 调用 API，因此需允许其跨域请求。
    // 部署时可以用 CORS_ALLOW_ORIGIN 收紧为已知的扩展 origin。
    const allowOrigin = process.env.CORS_ALLOW_ORIGIN || '*';
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
          { key: 'Access-Control-Expose-Headers', value: 'set-auth-token' },
        ],
      },
    ];
  },
};

export default nextConfig;
