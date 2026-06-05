/**
 * 全局用户设置 —— 跨设备同步、跨 context 共享。
 *
 * 存储位置：`chrome.storage.sync` key `readsight:settings`。容量小、走 sync
 * 才能让用户在 A 设备上调的偏好出现在 B 设备的同一账号上。
 *
 * 读取策略：每个 context（content / sidepanel / background）独立从 storage
 * 读，订阅 `chrome.storage.onChanged` 同步变化。不走 background 转发 —— 多一跳
 * 没必要，storage API 自带广播。
 */

export type SelectionIndicator = 'dot' | 'pill';

/**
 * 外语页面默认行为（按语言）：
 *   - `auto`：打开该语言页面直接自动双语翻译（除非该站设了 never 域名规则）
 *   - `manual`（默认）：安静待命，不弹任何提示，需要时点 FAB / 右键 / 快捷键
 * 取代了老版本"每个外语站都弹一次询问 banner"的形态 —— 见 docs/PROJECT_STATUS.md。
 */
export type LangBehavior = 'auto' | 'manual';

/** 语言偏好里"其他语言"兜底项的 key。 */
export const LANG_FALLBACK_KEY = '*';

export interface ReadsightSettings {
  /**
   * 划词后浮在选区上的指示器样式：
   *   - `dot`（默认）：选区右上角一颗小圆点 + 半透明 halo，最低干扰
   *   - `pill`：选区上方居中"Look up"胶囊按钮，老版本视觉
   * 两种点击行为一致：开词典 popup。
   */
  selectionIndicator: SelectionIndicator;
  /**
   * 按语言的外语页面默认行为。key = primary subtag（'en' / 'ja' / ...），
   * 特殊 key `*`（LANG_FALLBACK_KEY）= 未单独设定的"其他语言"兜底。
   * 用 resolveLangBehavior() 读，别直接索引（要处理 `*` 兜底）。
   */
  langBehavior: Record<string, LangBehavior>;
}

export const DEFAULT_SETTINGS: ReadsightSettings = {
  selectionIndicator: 'dot',
  // 默认全 manual：零打扰、零意外。想自动翻某语言去设置里改。
  langBehavior: { [LANG_FALLBACK_KEY]: 'manual' },
};

const STORAGE_KEY = 'readsight:settings';

function normalizeLangBehavior(raw: unknown): Record<string, LangBehavior> {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS.langBehavior };
  }
  const out: Record<string, LangBehavior> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'auto' || v === 'manual') out[k] = v;
  }
  // 兜底项必须存在，否则 resolveLangBehavior 退到硬编码 'manual'
  if (!out[LANG_FALLBACK_KEY]) out[LANG_FALLBACK_KEY] = 'manual';
  return out;
}

function normalize(raw: unknown): ReadsightSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const obj = raw as Partial<ReadsightSettings>;
  const indicator: SelectionIndicator =
    obj.selectionIndicator === 'pill' ? 'pill' : 'dot';
  return {
    selectionIndicator: indicator,
    langBehavior: normalizeLangBehavior(obj.langBehavior),
  };
}

/**
 * 解析某语言的外语页面行为：先查精确 lang，再退到 `*` 兜底，最后硬编码 manual。
 * content script 的 auto-start 决策用。
 */
export function resolveLangBehavior(
  s: ReadsightSettings,
  lang: string | null,
): LangBehavior {
  if (lang && s.langBehavior[lang]) return s.langBehavior[lang];
  return s.langBehavior[LANG_FALLBACK_KEY] ?? 'manual';
}

export async function getSettings(): Promise<ReadsightSettings> {
  try {
    const res = await chrome.storage.sync.get(STORAGE_KEY);
    return normalize(res[STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function patchSettings(
  patch: Partial<ReadsightSettings>,
): Promise<void> {
  const cur = await getSettings();
  const next = normalize({ ...cur, ...patch });
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
}

/** 订阅 settings 变化。返回 unsubscribe。 */
export function subscribeSettings(
  cb: (s: ReadsightSettings) => void,
): () => void {
  function listener(
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) {
    if (area !== 'sync') return;
    if (!(STORAGE_KEY in changes)) return;
    cb(normalize(changes[STORAGE_KEY].newValue));
  }
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---- React hook ---------------------------------------------------------
import { useEffect, useState } from 'react';

/**
 * React hook：拿当前 settings，自动跟 storage 变化同步。
 * 初次渲染返回 DEFAULT_SETTINGS，async 拿到真值后 setState 重渲染。
 * 任意 context 都能用（content / sidepanel）。
 */
export function useSettings(): ReadsightSettings {
  const [settings, setSettings] = useState<ReadsightSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let cancelled = false;
    getSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    const unsub = subscribeSettings(setSettings);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return settings;
}
