/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trend/core", "@trend/db"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  experimental: {
    // Next 14's default Client Router Cache reuses a previously-visited page's mounted
    // component (and its state) for 30s (dynamic routes) or 5 minutes (static routes) after a
    // soft ( <Link>/router.push) navigation away from it — meaning a "use client" admin page's
    // useEffect data-fetch does NOT re-run on a quick round trip back to it, showing stale data
    // (e.g. the AliExpress staging queue looking empty right after staging products elsewhere).
    // Admin screens need every navigation to reflect current state, so disable that reuse window
    // entirely rather than tune it.
    staleTimes: { dynamic: 0, static: 0 },
  },
};

export default nextConfig;
