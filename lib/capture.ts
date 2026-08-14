import { authFetch } from '@/lib/auth';

export const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';

export type CaptureMethod = 'side_panel' | 'tab_context_menu' | 'toolbar';

export type CaptureItem = {
  clientRequestId: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  captureMethod: CaptureMethod;
  intent?: string;
  projectIds?: string[];
};

export type CaptureResult =
  | { ok: true; clientRequestId: string; idempotent: boolean; source: { id: string }; capture: { id: string } }
  | { ok: false; clientRequestId: string | null; error: string; message: string };

export function captureItemFromTab(tab: chrome.tabs.Tab, captureMethod: CaptureMethod): CaptureItem | null {
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return null;
  return {
    clientRequestId: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || undefined,
    faviconUrl: tab.favIconUrl || undefined,
    captureMethod,
  };
}

export async function submitCaptures(items: CaptureItem[]): Promise<CaptureResult[]> {
  if (items.length === 0) return [];
  const response = await authFetch(`${BACKEND}/api/captures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (response.status === 401) {
    return items.map((item) => ({
      ok: false,
      clientRequestId: item.clientRequestId,
      error: 'unauthorized',
      message: '请先登录 Relata。',
    }));
  }
  const body = await response.json().catch(() => null) as { results?: CaptureResult[] } | null;
  if (!response.ok || !body?.results) {
    return items.map((item) => ({
      ok: false,
      clientRequestId: item.clientRequestId,
      error: 'capture_failed',
      message: '无法保存当前标签页。',
    }));
  }
  return body.results;
}
