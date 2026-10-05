import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Preserve the repository's explicitly approved scoped instructions.
  agentRules: false,
  async headers() {
    return ['/login', '/dashboard', '/auth/:path*', '/api/v1/auth/:path*'].map(source => ({
      source,
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Pragma', value: 'no-cache' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }));
  },
};

export default nextConfig;
