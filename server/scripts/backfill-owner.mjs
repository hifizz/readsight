import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });
const url = process.env.DATABASE_URL;
const ownerEmail = process.env.READSIGHT_OWNER_EMAIL?.trim().toLowerCase();
if (!url || !ownerEmail) {
  console.error('[backfill-owner] DATABASE_URL and READSIGHT_OWNER_EMAIL are required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const owners = await sql`
    SELECT id FROM readsight."user" WHERE lower(email) = ${ownerEmail}
  `;
  if (owners.length !== 1) throw new Error('owner email must resolve to exactly one account');
  const ownerId = owners[0].id;
  const counts = await sql.begin(async (tx) => {
    const contexts = await tx`UPDATE readsight.selection_contexts SET user_id = ${ownerId} WHERE user_id IS NULL`;
    const events = await tx`UPDATE readsight.encounter_events SET user_id = ${ownerId} WHERE user_id IS NULL`;
    const messages = await tx`UPDATE readsight.chat_messages SET user_id = ${ownerId} WHERE user_id IS NULL`;
    return { contexts: contexts.count, events: events.count, messages: messages.count };
  });
  console.log('[backfill-owner] assigned rows', counts);
} catch (error) {
  console.error('[backfill-owner] failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  await sql.end();
}
