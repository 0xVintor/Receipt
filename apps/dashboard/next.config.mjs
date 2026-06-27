/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Data is read via Node's built-in node:sqlite (no native addon), so nothing special is
  // needed here — node: builtins are external by default.
};

export default nextConfig;
