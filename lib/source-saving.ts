import { authFetch } from '@/lib/auth';

export const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
export type SourceSaveItem = { clientRequestId: string; url: string; title?: string; faviconUrl?: string; memo?: string | null; projectIds?: string[] };
export type SourceSaveResult =
  | { ok: true; clientRequestId: string; source: { id: string }; projectIds: string[] }
  | { ok: false; clientRequestId: string | null; error: string; message: string };

export function sourceItemFromTab(tab: chrome.tabs.Tab): SourceSaveItem | null {
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return null;
  return { clientRequestId: crypto.randomUUID(), url: tab.url, title: tab.title || undefined, faviconUrl: tab.favIconUrl || undefined };
}

export async function saveSources(items: SourceSaveItem[]): Promise<SourceSaveResult[]> {
  if (!items.length) return [];
  const response = await authFetch(`${BACKEND}/api/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  if (response.status === 401) return items.map((item) => ({ ok: false, clientRequestId: item.clientRequestId, error: 'unauthorized', message: '请先登录 Relata。' }));
  const body = await response.json().catch(() => null) as { results?: SourceSaveResult[] } | null;
  if (!response.ok || !body?.results) return items.map((item) => ({ ok: false, clientRequestId: item.clientRequestId, error: 'source_save_failed', message: '无法保存当前标签页。' }));
  return body.results;
}
