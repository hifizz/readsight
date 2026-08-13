import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });
const baseURL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4010';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Local-test-${crypto.randomUUID()}`;
const emails = [`auth-a-${suffix}@example.test`, `auth-b-${suffix}@example.test`];
const createdUserIds = [];

async function register(email) {
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: email.split('@')[0] }),
  });
  assert.equal(response.status, 200, `registration failed with ${response.status}`);
  const token = response.headers.get('set-auth-token');
  assert.ok(token, 'registration did not expose a bearer token');
  const body = await response.json();
  createdUserIds.push(body.user.id);
  return { token, user: body.user };
}

async function signIn(email) {
  const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `sign-in failed with ${response.status}`);
  const token = response.headers.get('set-auth-token');
  assert.ok(token, 'sign-in did not expose a bearer token');
  return { token, user: (await response.json()).user };
}

async function api(path, token, init = {}) {
  return fetch(`${baseURL}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
}

try {
  const anonymous = await fetch(`${baseURL}/api/history`);
  assert.equal(anonymous.status, 401);

  const a = await register(emails[0]);
  let b = await register(emails[1]);
  const signOutB = await api('/api/auth/sign-out', b.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(signOutB.status, 200);
  b = await signIn(emails[1]);
  const quotaResponse = await api('/api/translate', a.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: [{ id: 'quota', text: 'x'.repeat(200_001) }] }),
  });
  assert.equal(quotaResponse.status, 429);
  const quotaBody = await quotaResponse.json();
  assert.equal(quotaBody.error, 'daily_quota_exceeded');
  assert.ok(quotaBody.resetAt);
  const contextId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO readsight.selection_contexts
        (id, user_id, url, title, site_id, selection_text, selection_type,
         range_start, range_end, sentence, paragraph, anchor)
      VALUES
        (${contextId}, ${a.user.id}, 'https://example.test/a', 'A', 'example.test',
         'privateword', 'word', 0, 11, 'A privateword sentence.', 'A privateword sentence.',
         ${{ quote: { exact: 'privateword', prefix: 'A ', suffix: ' sentence.' } }})
    `;
    await tx`
      INSERT INTO readsight.encounter_events
        (id, user_id, item_key, surface_form, context_ref, event_type)
      VALUES (${eventId}, ${a.user.id}, 'privateword#noun', 'privateword', ${contextId}, 'lookup')
    `;
  });

  const ownershipCollision = await api('/api/lookup', b.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      word: 'privateword',
      selectionContext: {
        id: contextId,
        capturedAt: new Date().toISOString(),
        source: { url: 'https://example.test/b', title: 'B', siteId: 'example.test' },
        selection: { text: 'privateword', type: 'word', range: [0, 11] },
        context: { sentence: 'B privateword sentence.', paragraph: 'B privateword sentence.' },
        anchor: { quote: { exact: 'privateword', prefix: 'B ', suffix: ' sentence.' } },
      },
    }),
  });
  assert.equal(ownershipCollision.status, 409);

  const historyA = await api('/api/history', a.token);
  assert.equal(historyA.status, 200);
  assert.equal((await historyA.json()).items.length, 1);
  const historyB = await api('/api/history', b.token);
  assert.equal(historyB.status, 200);
  assert.equal((await historyB.json()).items.length, 0);
  const crossRead = await api(`/api/selection-context/${contextId}`, b.token);
  assert.equal(crossRead.status, 404);

  const signOutResponse = await api('/api/auth/sign-out', a.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(signOutResponse.status, 200);
  const revoked = await api('/api/history', a.token);
  assert.equal(revoked.status, 401);
  console.log('[smoke-auth] passed auth, isolation, revocation, and quota rejection');
} finally {
  if (createdUserIds.length) {
    await sql`DELETE FROM readsight."user" WHERE id = ANY(${createdUserIds})`;
  }
  await sql.end();
}
