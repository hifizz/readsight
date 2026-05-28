/**
 * Drizzle 客户端单例。
 *
 * - 用 `postgres-js` 而非 node-postgres：ESM 友好、性能更好、Drizzle 官方推荐
 * - 连接池上限 5：本期是本地 dev / 单实例后端，不需要更大
 * - `globalThis.__pg` 缓存：Next 16 在 dev 模式下会把 route module 反复热重启，
 *   每次重启都新建连接的话连接池会爆。挂全局只在 dev 用，prod 走正常一次性初始化。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Put it in server/.env.local');
}

const globalForPg = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
// idle_timeout / max_lifetime：让客户端主动回收老旧连接，规避电脑休眠 /
// Postgres 重启 / 长 idle 后第一个 query 拿到 ECONNRESET 的情况。
// 本地 dev 单实例后端，pool 上限 5 已经够；30s idle / 30min lifetime 是经验值。
const sql =
  globalForPg.__pg ??
  postgres(url, {
    max: 5,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
if (process.env.NODE_ENV !== 'production') globalForPg.__pg = sql;

export const db = drizzle(sql, { schema });
export { schema };
