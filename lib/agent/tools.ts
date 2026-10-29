/**
 * 侧边栏 agent 的工具。全部在扩展页面里执行：
 * 读页面走 content script，查词 / 记卡走和 background 同一套 IndexedDB。
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { BackgroundMessage, SelectionContext } from '@/lib/messaging';
import { lookupWord } from '@/lib/dict/lookup';
import { getHistory, recordEncounter, resolveItemKey } from '@/lib/records';

export interface ToolContext {
  ctx?: SelectionContext;
  tabId?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function tabResponds(tabId: number): Promise<boolean> {
  try {
    const res = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies BackgroundMessage),
      500,
    ) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/** 侧边栏自己不是网页。优先用调用方给的 tab，否则找一个注入了 content script 的标签。 */
export async function findContentTabId(preferred?: number): Promise<number | undefined> {
  if (preferred != null && (await tabResponds(preferred))) return preferred;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null || tab.id === preferred) continue;
    if (await tabResponds(tab.id)) return tab.id;
  }
  return undefined;
}

async function sendToContent<T>(preferred: number | undefined, message: BackgroundMessage): Promise<T> {
  const tabId = await findContentTabId(preferred);
  if (tabId == null) throw new Error('没有找到可读取的网页标签');
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

export function createTools({ ctx, tabId }: ToolContext): ToolSet {
  return {
    get_page_content: tool({
      description: '读取用户当前正在阅读的英文文章正文，返回标题、URL 和截断后的文本。',
      inputSchema: z.object({
        maxChars: z.number().int().positive().max(20000).optional(),
      }),
      execute: async ({ maxChars }) => {
        try {
          const res = await sendToContent<{
            ok?: boolean;
            article?: { title: string; url: string; text: string };
            error?: string;
          }>(tabId, { type: 'GET_ARTICLE', payload: { maxChars: maxChars ?? 12000 } });
          if (!res?.ok || !res.article) return { error: res?.error ?? '读取正文失败' };
          return res.article;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    get_paragraph_around_selection: tool({
      description: '根据选区原文，返回页面上包含这段文字的段落。',
      inputSchema: z.object({
        quote: z.string().optional(),
      }),
      execute: async ({ quote }) => {
        const exact = quote || ctx?.anchor.quote.exact || ctx?.selection.text;
        if (!exact) return { error: '没有选区可以定位' };
        try {
          const res = await sendToContent<{
            ok?: boolean;
            paragraph?: string;
            error?: string;
          }>(tabId, { type: 'GET_PARAGRAPH', payload: { quote: exact } });
          if (!res?.ok) return { error: res?.error ?? '定位段落失败' };
          return { quote: exact, paragraph: res.paragraph ?? '' };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    lookup_word: tool({
      description: '查英文单词。返回词性、中英文释义、音标。词典未收录时用模型估计。',
      inputSchema: z.object({ word: z.string().min(1) }),
      execute: async ({ word }) => {
        try {
          return await lookupWord(word);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    save_word_card: tool({
      description: '把单词写入用户的学习记录，可选附一句笔记。',
      inputSchema: z.object({
        word: z.string().min(1),
        note: z.string().optional(),
      }),
      execute: async ({ word, note }) => {
        const itemKey = await resolveItemKey(word);
        await recordEncounter({
          surfaceForm: word,
          itemKey,
          contextRef: ctx?.id ?? null,
          eventType: 'deepchat',
          note,
        });
        return { saved: true, word, itemKey };
      },
    }),
    mark_known: tool({
      description: '把单词标记为用户已经理解。',
      inputSchema: z.object({ word: z.string().min(1) }),
      execute: async ({ word }) => {
        const itemKey = await resolveItemKey(word);
        await recordEncounter({
          surfaceForm: word,
          itemKey,
          contextRef: ctx?.id ?? null,
          eventType: 'lookup',
          outcome: 'understood',
        });
        return { marked: true, word, itemKey };
      },
    }),
    search_my_records: tool({
      description: '在用户已有的学习记录里按单词或释义搜索。',
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        const history = await getHistory({ limit: 100 });
        const needle = query.trim().toLowerCase();
        const items = history.items
          .filter((item) => {
            const gloss = `${item.lastGloss?.cn ?? ''} ${item.lastGloss?.en ?? ''}`.toLowerCase();
            return item.itemKey.toLowerCase().includes(needle)
              || item.lastSurfaceForm.toLowerCase().includes(needle)
              || gloss.includes(needle);
          })
          .slice(0, 8)
          .map((item) => ({
            itemKey: item.itemKey,
            surfaceForm: item.lastSurfaceForm,
            lastTs: item.lastTs,
            count: item.totalCount,
            gloss: item.lastGloss?.cn || item.lastGloss?.en || null,
            sentence: item.lastSentence ?? null,
          }));
        return { items };
      },
    }),
  };
}
