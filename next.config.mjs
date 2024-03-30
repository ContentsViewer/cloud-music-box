/** @type {import('next').NextConfig} */


import withPWA from "next-pwa";

const config = {
  reactStrictMode: true,
  output: "export"
};


const nextConfig = {
  ...config,
  ...withPWA({
    dest: "public",
  })
};

export default nextConfig;