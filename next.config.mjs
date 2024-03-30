/** @type {import('next').NextConfig} */


import withPWA from "next-pwa";

const config = {
  reactStrictMode: true,
};


const nextConfig = {
  ...config,
  ...withPWA({
    dest: "public",
  })
};

export default nextConfig;