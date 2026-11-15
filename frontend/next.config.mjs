import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
};

export default config;
