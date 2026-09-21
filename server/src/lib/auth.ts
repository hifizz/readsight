import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { db, schema } from '@/db/client';

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:4010';
const configuredOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const developmentOrigins =
  process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'chrome-extension://*'];

export const auth = betterAuth({
  appName: 'Relata',
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  trustedOrigins: [baseURL, ...developmentOrigins, ...configuredOrigins],
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/sign-up/email': { window: 60, max: 5 },
      '/sign-in/email': { window: 60, max: 10 },
    },
  },
  plugins: [bearer({ requireSignature: true })],
});

export type AuthSession = typeof auth.$Infer.Session;
