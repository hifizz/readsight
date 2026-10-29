/**
 * 扩展 origin 上的 IndexedDB。background 和 side panel 共用；
 * content script 在页面 origin 下，访问不到，必须经 runtime message。
 *
 * 每行留 updatedAt / deletedAt / dirty，方便以后按脏行做云同步。
 */
import Dexie, { type Table } from 'dexie';
import type { LookupResult, SelectionContext, SelectionType } from '@/lib/messaging';

export interface SyncMeta {
  updatedAt: string;
  deletedAt: string | null;
  dirty: boolean;
}

export interface SelectionContextRow extends SyncMeta {
  id: string;
  capturedAt: string;
  url: string;
  title: string;
  siteId: string;
  heading?: string;
  selectionText: string;
  selectionType: SelectionType;
  rangeStart: number;
  rangeEnd: number;
  sentence: string;
  paragraph: string;
  anchor: SelectionContext['anchor'];
}

export type EncounterEventType = 'lookup' | 'quick' | 'deepchat' | 'passive_reencounter';
export type EncounterOutcome = 'understood' | 'still_unsure';

export interface EncounterEventRow extends SyncMeta {
  id: string;
  itemKey: string;
  surfaceForm: string;
  contextRef: string | null;
  eventType: EncounterEventType;
  outcome?: EncounterOutcome | null;
  ts: string;
  note?: string;
}

export interface ChatMessageRow extends SyncMeta {
  id: string;
  threadId: string;
  selectionContextId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  createdAt: string;
}

export interface DictCacheRow extends SyncMeta {
  lemma: string;
  payload: LookupResult;
  source: string;
}

export interface TranslationRow extends SyncMeta {
  hash: string;
  zh: string;
  model: string;
  originalText: string;
}

export function syncStamp(now = new Date().toISOString()): SyncMeta {
  return { updatedAt: now, deletedAt: null, dirty: true };
}

export class ReadsightDB extends Dexie {
  selectionContexts!: Table<SelectionContextRow, string>;
  encounterEvents!: Table<EncounterEventRow, string>;
  chatMessages!: Table<ChatMessageRow, string>;
  dictCache!: Table<DictCacheRow, string>;
  translations!: Table<TranslationRow, string>;

  constructor() {
    super('readsight');
    this.version(1).stores({
      selectionContexts: 'id, capturedAt, url, updatedAt, dirty',
      encounterEvents: 'id, itemKey, ts, eventType, [itemKey+ts], updatedAt, dirty',
      chatMessages: 'id, threadId, createdAt, updatedAt, dirty',
      dictCache: 'lemma, updatedAt, dirty',
      translations: 'hash, updatedAt',
    });
  }
}

export const db = new ReadsightDB();
