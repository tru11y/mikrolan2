/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build autonome : `.next/standalone` contient server.js + un node_modules élagué.
  // L'artefact de déploiement n'embarque donc que le standalone (pas tout node_modules).
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
