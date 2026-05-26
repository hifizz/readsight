/**
 * 域名级翻译规则 —— 让用户读英文站时"打开即翻"，跨 tab / SPA 持续生效。
 *
 * 存储位置：chrome.storage.sync，规则量小 + 跨设备同步用户偏好。
 *
 * 三态语义：
 *   - 'always': 命中则自动翻译，跨 tab / 刷新 / SPA 跳转都续；mode 决定 article/page
 *   - 'never':  命中则连 FAB 也不挂（排除 Gmail / Notion 等复杂 WebApp）
 *   - 无规则:   用户得手动点 FAB；本次行为不影响下次（= "仅本次"）
 *
 * Domain key 用规范化后的 hostname（剥 www.）。MVP 不做 eTLD+1，
 * 也不做路径前缀（github.com/anthropic/*）—— 后者可以以后再加 paths 字段。
 */

import type { TranslateMode } from '@/entrypoints/content/translate';

export interface DomainRule {
  /** 'always' = 自动翻译；'never' = 屏蔽 FAB；删规则 = 默认手动 */
  auto: 'always' | 'never';
  /** auto=always 时生效，never 时无意义但仍写入避免再切换时丢偏好 */
  mode: TranslateMode;
}

const STORAGE_KEY = 'english-agent:domain-rules';

/** hostname 规范化 —— 剥 www. 前缀，全小写。 */
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

async function readAll(): Promise<Record<string, DomainRule>> {
  try {
    const got = await chrome.storage.sync.get(STORAGE_KEY);
    const raw = got[STORAGE_KEY];
    return raw && typeof raw === 'object' ? (raw as Record<string, DomainRule>) : {};
  } catch (err) {
    console.warn('[english-agent] domain-rules read failed', err);
    return {};
  }
}

async function writeAll(rules: Record<string, DomainRule>): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: rules });
  } catch (err) {
    console.warn('[english-agent] domain-rules write failed', err);
  }
}

export async function getDomainRule(hostname: string): Promise<DomainRule | null> {
  const key = normalizeHostname(hostname);
  const all = await readAll();
  return all[key] ?? null;
}

export async function setDomainRule(hostname: string, rule: DomainRule): Promise<void> {
  const key = normalizeHostname(hostname);
  const all = await readAll();
  all[key] = rule;
  await writeAll(all);
}

export async function clearDomainRule(hostname: string): Promise<void> {
  const key = normalizeHostname(hostname);
  const all = await readAll();
  if (!(key in all)) return;
  delete all[key];
  await writeAll(all);
}

/**
 * 订阅自己 hostname 的规则变化 —— 用户在 sidepanel / 另一 tab 改规则时，
 * 当前页可以即时响应（隐藏 FAB / 启动翻译）。
 * 返回 unsubscribe。
 */
export function subscribeDomainRule(
  hostname: string,
  cb: (rule: DomainRule | null) => void,
): () => void {
  const key = normalizeHostname(hostname);
  function onChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'sync') return;
    if (!(STORAGE_KEY in changes)) return;
    const next = (changes[STORAGE_KEY].newValue ?? {}) as Record<string, DomainRule>;
    cb(next[key] ?? null);
  }
  chrome.storage.onChanged.addListener(onChange);
  return () => chrome.storage.onChanged.removeListener(onChange);
}
