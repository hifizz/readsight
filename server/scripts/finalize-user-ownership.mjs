import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[finalize-ownership] DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM readsight.selection_contexts WHERE user_id IS NULL) AS contexts,
      (SELECT count(*)::int FROM readsight.encounter_events WHERE user_id IS NULL) AS events,
      (SELECT count(*)::int FROM readsight.chat_messages WHERE user_id IS NULL) AS messages
  `;
  if (counts.contexts || counts.events || counts.messages) {
    throw new Error(`unowned rows remain: ${JSON.stringify(counts)}`);
  }
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE readsight.selection_contexts ALTER COLUMN user_id SET NOT NULL`;
    await tx`ALTER TABLE readsight.encounter_events ALTER COLUMN user_id SET NOT NULL`;
    await tx`ALTER TABLE readsight.chat_messages ALTER COLUMN user_id SET NOT NULL`;
  });
  console.log('[finalize-ownership] ownership columns are now NOT NULL');
} catch (error) {
  console.error('[finalize-ownership] failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  await sql.end();
}
