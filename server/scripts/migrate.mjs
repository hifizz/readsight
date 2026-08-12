// 部署时自动跑的数据库迁移。容器内执行，走内网连 DATABASE_URL，幂等。
// 迁移 SQL 来自 `drizzle/`（由 `pnpm db:generate` 生成并提交进仓库）。
// 用 drizzle-orm 的 migration reader（运行时依赖），不依赖 drizzle-kit（devDependency）。
// SQL 由下方的最小执行器运行，避免共享数据库时要求应用账号拥有全库 CREATE 权限。
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

const APP_SCHEMA = 'readsight';
const MIGRATIONS_SCHEMA = 'readsight_migrations';
const MIGRATIONS_TABLE = '__drizzle_migrations';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL 未设置，跳不过去');
  process.exit(1);
}

// migrationsFolder 相对脚本自身定位，不受 cwd 影响。
const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;
const sql = postgres(url, { max: 1 });

/**
 * 旧版本将业务表留在 public、迁移历史留在 drizzle。首次升级时只迁移本项目
 * 已执行的 migration hash 到 readsight_migrations，避免与同库其他项目的
 * history 混用，然后由正式 migrator 执行本次的 schema 搬迁。
 */
async function adoptLegacyMigrationHistory() {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length === 0) return;

  const migrationSchema = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname = ${MIGRATIONS_SCHEMA}
    ) AS exists
  `;
  if (!migrationSchema[0]?.exists) {
    await sql.unsafe(`CREATE SCHEMA "${MIGRATIONS_SCHEMA}"`);
  }

  const migrationTable = await sql`
    SELECT to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) AS relation
  `;
  if (!migrationTable[0]?.relation) {
    await sql.unsafe(`
      CREATE TABLE "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
      )
    `);
  }

  const targetHistory = await sql.unsafe(
    `SELECT hash FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" LIMIT 1`,
  );
  if (targetHistory.length > 0) return;

  const managedTables = [
    'chat_messages',
    'dictionary_entries',
    'encounter_events',
    'selection_contexts',
    'translations',
    'tts_cache',
  ];
  const legacyTables = await sql`
    SELECT count(*)::int AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY(${managedTables})
  `;
  const readsightTables = await sql`
    SELECT count(*)::int AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${APP_SCHEMA}
      AND c.relkind = 'r'
      AND c.relname = ANY(${managedTables})
  `;

  // 旧版本已在 public 建好完整对象：把当前的 0000 标记为已执行，让 0001
  // 只负责无损搬迁。若对象已在 readsight（例如手工恢复的库）也同样跳过 0000。
  if (
    legacyTables[0]?.count === managedTables.length ||
    readsightTables[0]?.count === managedTables.length
  ) {
    const baseline = migrations[0];
    await sql.unsafe(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [baseline.hash, baseline.folderMillis],
    );
    return;
  }

  const legacyTable = await sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') AS relation
  `;
  if (!legacyTable[0]?.relation) return;

  const legacyHistory = await sql.unsafe(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations',
  );
  const knownHashes = new Set(migrations.map((migration) => migration.hash));
  const matchedLegacy = legacyHistory.filter((row) => knownHashes.has(row.hash));
  for (const row of matchedLegacy) {
    await sql.unsafe(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [row.hash, row.created_at],
    );
  }
}

/**
 * Drizzle 内置 migrator 每次都会执行 `CREATE SCHEMA IF NOT EXISTS`，这要求
 * 应用账号拥有整个 database 的 CREATE 权限。共享数据库中不应授予该权限：
 * 本实现只在 Readsight 已拥有的迁移 schema 中读取和执行未完成的 SQL 文件。
 */
async function applyPendingMigrations() {
  const migrations = readMigrationFiles({ migrationsFolder });
  const lastMigration = await sql.unsafe(
    `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
  );
  const lastAppliedAt = Number(lastMigration[0]?.created_at ?? 0);

  const pending = migrations.filter((migration) => migration.folderMillis > lastAppliedAt);
  if (pending.length === 0) return;

  await sql.begin(async (tx) => {
    for (const migration of pending) {
      for (const statement of migration.sql) {
        await tx.unsafe(statement);
      }
      await tx.unsafe(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
    }
  });
}

try {
  await adoptLegacyMigrationHistory();
  console.log('[migrate] applying migrations from', migrationsFolder);
  await applyPendingMigrations();
  console.log('[migrate] done');
} catch (e) {
  console.error('[migrate] failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
