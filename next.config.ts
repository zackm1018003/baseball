import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'a.espncdn.com',
        pathname: '/i/**',
      },
      {
        protocol: 'https',
        hostname: 'img.mlbstatic.com',
        pathname: '/mlb-photos/**',
      },
      {
        protocol: 'https',
        hostname: 'www.mlbstatic.com',
        pathname: '/team-logos/**',
      },
      {
        protocol: 'http',
        hostname: 'gdx.mlb.com',
        pathname: '/images/**',
      },
    ],
  },
};

export default nextConfig;
