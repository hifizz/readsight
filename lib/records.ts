/**
 * 学习记录、词典缓存、翻译缓存的本地读写。对应原来的
 * /api/history、/api/known-items、/api/encounter、/api/selection-context。
 */
import type { LookupResult, SelectionContext } from '@/lib/messaging';
import { KNOWN_ITEMS_CACHE_KEY } from '@/lib/messaging';
import { resolveLemma } from '@/lib/lemmatize';
import {
  db,
  syncStamp,
  type ChatMessageRow,
  type EncounterEventRow,
  type EncounterEventType,
  type EncounterOutcome,
  type SelectionContextRow,
} from '@/lib/db';

const KNOWN_ITEMS_TTL_MS = 5 * 60 * 1000;

export interface HistoryGloss {
  pos?: string;
  cn?: string;
  en?: string;
  estimated?: boolean;
}

export interface HistoryRecord {
  itemKey: string;
  lastSurfaceForm: string;
  lastTs: string;
  lastContextRef: string | null;
  totalCount: number;
  eventTypes: string[];
  lastSentence?: string | null;
  lastUrl?: string | null;
  lastGloss?: HistoryGloss | null;
}

export interface LearningExport {
  version: 1;
  exportedAt: string;
  selectionContexts: SelectionContextRow[];
  encounterEvents: EncounterEventRow[];
  chatMessages: ChatMessageRow[];
}

export interface ImportCounts {
  selectionContexts: number;
  encounterEvents: number;
  chatMessages: number;
}

export function selectionContextToRow(ctx: SelectionContext): SelectionContextRow {
  return {
    id: ctx.id,
    capturedAt: ctx.capturedAt,
    url: ctx.source.url,
    title: ctx.source.title,
    siteId: ctx.source.siteId,
    heading: ctx.source.heading,
    selectionText: ctx.selection.text,
    selectionType: ctx.selection.type,
    rangeStart: ctx.selection.range[0],
    rangeEnd: ctx.selection.range[1],
    sentence: ctx.context.sentence,
    paragraph: ctx.context.paragraph,
    anchor: ctx.anchor,
    ...syncStamp(),
  };
}

export function rowToSelectionContext(row: SelectionContextRow): SelectionContext {
  return {
    id: row.id,
    capturedAt: row.capturedAt,
    source: {
      url: row.url,
      title: row.title,
      siteId: row.siteId,
      heading: row.heading,
    },
    selection: {
      text: row.selectionText,
      type: row.selectionType,
      range: [row.rangeStart, row.rangeEnd],
    },
    context: { sentence: row.sentence, paragraph: row.paragraph },
    anchor: row.anchor,
  };
}

export async function upsertSelectionContext(ctx: SelectionContext): Promise<void> {
  const existing = await db.selectionContexts.get(ctx.id);
  const row = selectionContextToRow(ctx);
  if (existing && !existing.deletedAt && existing.updatedAt > row.updatedAt) return;
  await db.selectionContexts.put(row);
}

export async function getSelectionContext(id: string): Promise<SelectionContext | null> {
  const row = await db.selectionContexts.get(id);
  if (!row || row.deletedAt) return null;
  return rowToSelectionContext(row);
}

async function invalidateKnownItemsCache(): Promise<void> {
  try {
    await chrome.storage.session.remove(KNOWN_ITEMS_CACHE_KEY);
  } catch {
    /* session storage 在极少数启动瞬间不可用，下次扫描会重新算 */
  }
}

export async function recordEncounter(input: {
  surfaceForm: string;
  itemKey: string;
  contextRef: string | null;
  eventType: EncounterEventType;
  outcome?: EncounterOutcome | null;
  note?: string;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db.encounterEvents.add({
      id: crypto.randomUUID(),
      itemKey: input.itemKey,
      surfaceForm: input.surfaceForm,
      contextRef: input.contextRef,
      eventType: input.eventType,
      outcome: input.outcome ?? null,
      note: input.note,
      ts: now,
      ...syncStamp(now),
    });
    await invalidateKnownItemsCache();
  } catch (err) {
    console.warn('[readsight] encounter insert failed', err);
  }
}

export async function recordPassiveReencounterDeduped(input: {
  surfaceForm: string;
  itemKey: string;
}): Promise<{ written: boolean }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const existing = await db.encounterEvents
      .where('itemKey')
      .equals(input.itemKey)
      .filter((row) => !row.deletedAt && row.eventType === 'passive_reencounter' && row.ts >= since)
      .first();
    if (existing) return { written: false };
    await recordEncounter({
      surfaceForm: input.surfaceForm,
      itemKey: input.itemKey,
      contextRef: null,
      eventType: 'passive_reencounter',
    });
    return { written: true };
  } catch (err) {
    console.warn('[readsight] passive insert failed', err);
    return { written: false };
  }
}

export async function findCanonicalItemKey(lemma: string): Promise<string> {
  const prefix = `${lemma}#`;
  const rows = await db.encounterEvents
    .filter((row) =>
      !row.deletedAt &&
      row.itemKey.startsWith(prefix) &&
      row.eventType !== 'passive_reencounter',
    )
    .toArray();
  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  return rows[0]?.itemKey ?? `${lemma}#unknown`;
}

export async function recordPassiveHits(
  items: Array<{ surfaceForm: string; lemma: string }>,
): Promise<void> {
  for (const item of items.slice(0, 200)) {
    if (!item.lemma || !item.surfaceForm) continue;
    const itemKey = await findCanonicalItemKey(item.lemma);
    await recordPassiveReencounterDeduped({
      surfaceForm: item.surfaceForm,
      itemKey,
    });
  }
}

export async function resolveItemKey(surfaceForm: string): Promise<string> {
  const lemma = resolveLemma(surfaceForm.trim());
  const cached = await db.dictCache.get(lemma);
  if (cached && !cached.deletedAt && cached.payload.itemKey) return cached.payload.itemKey;
  return findCanonicalItemKey(lemma);
}

export async function getKnownLemmas(): Promise<string[]> {
  const rows = await db.encounterEvents
    .filter((row) => !row.deletedAt && row.eventType !== 'passive_reencounter')
    .toArray();
  const lemmas = new Set<string>();
  for (const row of rows) {
    const idx = row.itemKey.indexOf('#');
    lemmas.add(idx > 0 ? row.itemKey.slice(0, idx) : row.itemKey);
  }
  return [...lemmas];
}

export async function getKnownLemmasCached(): Promise<string[]> {
  try {
    const cached = await chrome.storage.session.get(KNOWN_ITEMS_CACHE_KEY);
    const entry = cached[KNOWN_ITEMS_CACHE_KEY] as
      | { lemmas: string[]; expiresAt: number }
      | undefined;
    if (entry && entry.expiresAt > Date.now() && Array.isArray(entry.lemmas)) {
      return entry.lemmas;
    }
  } catch {
    /* 直接算 */
  }
  const lemmas = await getKnownLemmas();
  try {
    await chrome.storage.session.set({
      [KNOWN_ITEMS_CACHE_KEY]: { lemmas, expiresAt: Date.now() + KNOWN_ITEMS_TTL_MS },
    });
  } catch {
    /* 缓存写失败不影响返回 */
  }
  return lemmas;
}

function glossFor(itemKey: string, payload?: LookupResult): HistoryGloss | null {
  if (!payload) return null;
  const posPart = itemKey.split('#')[1]?.toLowerCase() ?? '';
  const pos =
    payload.partsOfSpeech.find((part) => part.pos?.toLowerCase() === posPart) ??
    payload.partsOfSpeech[0];
  const def = pos?.definitions?.[0];
  if (!def || (!def.cn && !def.definition)) return null;
  return {
    pos: pos.pos && pos.pos !== '—' ? pos.pos : undefined,
    cn: def.cn || undefined,
    en: def.definition || undefined,
    estimated: payload.estimated === true,
  };
}

export async function getHistory(options?: {
  limit?: number;
  before?: string;
}): Promise<{ items: HistoryRecord[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const before = options?.before ?? null;
  const events = await db.encounterEvents.filter((row) => !row.deletedAt).toArray();
  const grouped = new Map<string, EncounterEventRow[]>();
  for (const event of events) {
    if (before && event.ts >= before) continue;
    const list = grouped.get(event.itemKey) ?? [];
    list.push(event);
    grouped.set(event.itemKey, list);
  }
  const aggregates = [...grouped.entries()].map(([itemKey, list]) => {
    list.sort((a, b) => b.ts.localeCompare(a.ts));
    const last = list[0];
    return {
      itemKey,
      lastSurfaceForm: last.surfaceForm,
      lastTs: last.ts,
      lastContextRef: last.contextRef,
      totalCount: list.length,
      eventTypes: [...new Set(list.map((row) => row.eventType))],
    };
  });
  aggregates.sort((a, b) => b.lastTs.localeCompare(a.lastTs));
  const page = aggregates.slice(0, limit);
  const nextCursor = aggregates.length > limit ? page[page.length - 1]?.lastTs ?? null : null;

  const refs = page.map((row) => row.lastContextRef).filter((id): id is string => Boolean(id));
  const ctxRows = refs.length
    ? await db.selectionContexts.where('id').anyOf(refs).toArray()
    : [];
  const ctxById = new Map(ctxRows.filter((row) => !row.deletedAt).map((row) => [row.id, row]));

  const lemmas = [...new Set(page.map((row) => row.itemKey.split('#')[0]).filter(Boolean))];
  const dictRows = lemmas.length ? await db.dictCache.where('lemma').anyOf(lemmas).toArray() : [];
  const dictByLemma = new Map(dictRows.filter((row) => !row.deletedAt).map((row) => [row.lemma, row]));

  return {
    items: page.map((row) => {
      const ctx = row.lastContextRef ? ctxById.get(row.lastContextRef) : undefined;
      return {
        ...row,
        lastSentence: ctx?.sentence ?? null,
        lastUrl: ctx?.url ?? null,
        lastGloss: glossFor(row.itemKey, dictByLemma.get(row.itemKey.split('#')[0])?.payload),
      };
    }),
    nextCursor,
  };
}

export async function recordChatTurn(input: {
  ctx: SelectionContext;
  userText: string;
  assistantText: string;
  actionTag?: string;
}): Promise<void> {
  await upsertSelectionContext(input.ctx);
  const now = new Date().toISOString();
  const threadId = input.ctx.id;
  if (input.userText) {
    await db.chatMessages.add({
      id: crypto.randomUUID(),
      threadId,
      selectionContextId: input.ctx.id,
      role: 'user',
      content: { text: input.userText },
      createdAt: now,
      ...syncStamp(now),
    });
  }
  await db.chatMessages.add({
    id: crypto.randomUUID(),
    threadId,
    selectionContextId: input.ctx.id,
    role: 'assistant',
    content: { text: input.assistantText },
    createdAt: now,
    ...syncStamp(now),
  });
  if (input.ctx.selection.type === 'word') {
    const itemKey = await resolveItemKey(input.ctx.selection.text);
    await recordEncounter({
      surfaceForm: input.ctx.selection.text,
      itemKey,
      contextRef: input.ctx.id,
      eventType: input.actionTag ? 'quick' : 'deepchat',
    });
  }
}

export async function exportLearningData(): Promise<string> {
  const [selectionContexts, encounterEvents, chatMessages] = await Promise.all([
    db.selectionContexts.toArray(),
    db.encounterEvents.toArray(),
    db.chatMessages.toArray(),
  ]);
  const payload: LearningExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    selectionContexts,
    encounterEvents,
    chatMessages,
  };
  return JSON.stringify(payload, null, 2);
}

function isRow(value: unknown): value is { id?: string; lemma?: string; updatedAt?: string } {
  return Boolean(value) && typeof value === 'object';
}

async function mergeById<T extends { id: string; updatedAt: string }>(
  table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> },
  rows: T[],
): Promise<number> {
  let written = 0;
  for (const row of rows) {
    if (!row?.id) continue;
    const existing = await table.get(row.id);
    if (existing && existing.updatedAt > (row.updatedAt ?? '')) continue;
    await table.put({ ...row, dirty: true });
    written += 1;
  }
  return written;
}

export async function importLearningData(json: string): Promise<ImportCounts> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的学习记录文件');
  const body = parsed as Partial<LearningExport>;
  if (body.version !== 1) throw new Error('不认识的导出版本');
  const selectionContexts = Array.isArray(body.selectionContexts) ? body.selectionContexts.filter(isRow) : [];
  const encounterEvents = Array.isArray(body.encounterEvents) ? body.encounterEvents.filter(isRow) : [];
  const chatMessages = Array.isArray(body.chatMessages) ? body.chatMessages.filter(isRow) : [];
  const counts = {
    selectionContexts: await mergeById(db.selectionContexts, selectionContexts as SelectionContextRow[]),
    encounterEvents: await mergeById(db.encounterEvents, encounterEvents as EncounterEventRow[]),
    chatMessages: await mergeById(db.chatMessages, chatMessages as ChatMessageRow[]),
  };
  await invalidateKnownItemsCache();
  return counts;
}

export async function clearLearningData(): Promise<void> {
  await db.transaction('rw', db.selectionContexts, db.encounterEvents, db.chatMessages, async () => {
    await db.selectionContexts.clear();
    await db.encounterEvents.clear();
    await db.chatMessages.clear();
  });
  await invalidateKnownItemsCache();
}
