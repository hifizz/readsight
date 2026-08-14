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
  // 只检查 Relata 的命名空间；同库其他项目的对象不参与 drizzle-kit diff/push。
  schemaFilter: ['relata'],
  // 单独存迁移历史，避免 schemaFilter 将其误判为待删除的业务表。
  migrations: { schema: 'relata_migrations' },
  // verbose: push 时打印 SQL，方便审计要执行的 DDL。
  verbose: true,
});
