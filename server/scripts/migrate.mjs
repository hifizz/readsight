// 部署时自动跑的数据库迁移。容器内执行，走内网连 DATABASE_URL，幂等。
// 迁移 SQL 来自 `drizzle/`（由 `pnpm db:generate` 生成并提交进仓库）。
// 用 drizzle-orm 的 migrator（运行时依赖），不依赖 drizzle-kit（devDependency）。
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL 未设置，跳不过去');
  process.exit(1);
}

// migrationsFolder 相对脚本自身定位，不受 cwd 影响。
const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;
const sql = postgres(url, { max: 1 });

try {
  console.log('[migrate] applying migrations from', migrationsFolder);
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('[migrate] done');
} catch (e) {
  console.error('[migrate] failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
