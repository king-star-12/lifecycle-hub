import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dataset lives on disk and is read by the server at request time.
  outputFileTracingIncludes: {
    '/**': ['./data/synthetic/**'],
  },
};

export default nextConfig;
