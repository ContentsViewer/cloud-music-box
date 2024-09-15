/** @type {import('next').NextConfig} */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

import withSerwistInit from '@serwist/next';
import { nanoid } from 'nanoid';

const revision = nanoid();

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  additionalPrecacheEntries: [
    { url: "404.html", revision: revision },
    { url: "files.html", revision: revision },
    { url: "files.txt", revision: revision },
    { url: "home.html", revision: revision },
    { url: "home.txt", revision: revision },
    { url: "index.html", revision: revision },
    { url: "index.txt", revision: revision },
    { url: "redirect.html", revision: revision },
    { url: "redirect.txt", revision: revision },
    { url: "settings.html", revision: revision },
    { url: "settings.txt", revision: revision },
    { url: "albums.html", revision: revision },
    { url: "albums.txt", revision: revision },
  ],
  reloadOnOnline: false,
  register: false,
});

export default withSerwist({
  basePath: basePath,
  reactStrictMode: true,
  output: "export",
  transpilePackages: ['three'],
  env: {
    APP_VERSION: process.env.npm_package_version
  },
  compiler: {
    emotion: true
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        // Reduce a lot of js chunks.
        cacheGroups: {
          default: false,
          vendors: false,
        },
      };
    }
    return config;
  },
});
