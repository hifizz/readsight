/**
 * drizzle-kit 命令行配置。
 *
 * 显式加载 .env.local：drizzle-kit 不像 next dev 那样自动读 .env.local，
 * 直接 `pnpm exec drizzle-kit push` 会拿不到 DATABASE_URL。
 */
import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Put it in server/.env.local');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
  // verbose: push 时打印 SQL，方便审计要执行的 DDL。
  verbose: true,
});
