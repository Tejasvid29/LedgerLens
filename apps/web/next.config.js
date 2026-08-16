/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@ledgerlens/shared'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

module.exports = nextConfig;
