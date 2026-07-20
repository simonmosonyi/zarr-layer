/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // Proxy S1-ARD zarr store through the Next.js server to avoid CORS.
      // Objects.eodc.eu does not send Access-Control-Allow-Origin headers.
      // The bucket name contains a colon, URL-encoded as %3A for compatibility.
      {
        source: '/s1-zarr/:path*',
        destination:
          'https://objects.eodc.eu/88346baf22914e828ad2c1763e5e01ff%3As1-ard/s1-wizsard-at.zarr/:path*',
      },
    ]
  },
}

module.exports = nextConfig
