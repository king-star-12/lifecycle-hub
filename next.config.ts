import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone emits a self-contained server with only the modules actually
  // reached, which keeps the deployment package small enough to zip-deploy.
  output: 'standalone',

  // The dataset is read from disk by the server at request time, so it has to
  // be traced into the standalone bundle. The ground-truth file is deliberately
  // excluded: it is the simulator's answer key and the application must never
  // be able to open it, in production least of all.
  outputFileTracingIncludes: {
    '/**': ['./data/synthetic/**'],
  },
  outputFileTracingExcludes: {
    '/**': ['./data/synthetic/_ground-truth.json', './data/stage/**', './data/documents/**'],
  },
};

export default nextConfig;
