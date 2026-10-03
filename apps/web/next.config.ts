import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Preserve the repository's explicitly approved scoped instructions.
  agentRules: false,
};

export default nextConfig;
