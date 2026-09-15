/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4002',
    // Where this product hands people back to their account, and across to its
    // siblings. Defaults match the dev ports in the ecosystem README.
    NEXT_PUBLIC_ACCOUNTS_ORIGIN: process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? 'http://localhost:3000',
    NEXT_PUBLIC_FINVOICE_ORIGIN: process.env.NEXT_PUBLIC_FINVOICE_ORIGIN ?? 'http://localhost:3001',
    NEXT_PUBLIC_TALK_ORIGIN: process.env.NEXT_PUBLIC_TALK_ORIGIN ?? 'http://localhost:3002',
    NEXT_PUBLIC_PAYROLL_ORIGIN: process.env.NEXT_PUBLIC_PAYROLL_ORIGIN ?? 'http://localhost:3003',
  },
};

export default nextConfig;
