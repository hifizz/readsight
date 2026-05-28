/**
 * 页面语言检测 —— 用来 gate 自动翻译，避免在中文页上对中文用户误触发。
 *
 * 检测来源（优先级）：
 *   1. chrome.i18n.detectLanguage 跑页面 body 前 ~2000 字符
 *      Chrome 内置 CLD3 模型，比 <html lang> 准 —— 很多英文站点
 *      默认写 lang="en" 但实际内容是 zh 镜像，反之亦然
 *   2. document.documentElement.lang —— Chrome 检测不可靠 / 不返回时的兜底
 *   3. 都失败 → 返回 null，调用方按"不同语言"处理（保守翻译）
 *
 * 主子标签比较：'zh-CN' / 'zh-TW' / 'zh-Hans' 都视为 zh；en-US / en-GB → en。
 */

/** 拿前 N 个有内容的字符送 CLD3。document.body 直接 textContent 会含一堆空白 */
const SAMPLE_CHAR_LIMIT = 2000;

export interface DetectionResult {
  /** 'zh' / 'en' / 'ja'... null 表示检测不出 */
  lang: string | null;
  /** chrome.i18n 给的 isReliable；documentElement.lang fallback 时 false */
  reliable: boolean;
  /** 用于 debug / hint 显示：哪种途径定的（'cld3' / 'html-lang' / 'none'）*/
  source: 'cld3' | 'html-lang' | 'none';
}

/** 把 'zh-CN' / 'zh_Hans_CN' 之类的 BCP47 / Unicode locale id 收成主子标签 */
export function primarySubtag(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const first = lang.toLowerCase().split(/[-_]/)[0];
  return first || null;
}

export function getUserPrimaryLang(): string {
  return primarySubtag(navigator.language) ?? 'en';
}

/** 主子标签相同视为同语言；null 视为不同（保守翻译） */
export function isSamePrimary(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return primarySubtag(a) === primarySubtag(b);
}

function sampleBodyText(): string {
  // textContent 比 innerText 快得多（innerText 触发 layout）。代价是会把
  // 多个 block 的文本连成一行 —— 对语言检测无影响。
  const raw = document.body?.textContent ?? '';
  // collapse whitespace 一遍，把 \n\n\n 之类的空白挤掉，让样本更稠密
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.slice(0, SAMPLE_CHAR_LIMIT);
}

export async function detectPageLanguage(): Promise<DetectionResult> {
  // 1. chrome.i18n.detectLanguage（CLD3）
  if (typeof chrome !== 'undefined' && chrome.i18n?.detectLanguage) {
    const sample = sampleBodyText();
    if (sample.length >= 20) {
      try {
        const res = await chrome.i18n.detectLanguage(sample);
        const top = res?.languages?.[0];
        if (top?.language) {
          return {
            lang: primarySubtag(top.language),
            reliable: !!res.isReliable,
            source: 'cld3',
          };
        }
      } catch (err) {
        console.warn('[readsight] chrome.i18n.detectLanguage failed', err);
      }
    }
  }

  // 2. <html lang> 兜底（常常不准，所以标 reliable=false）
  const htmlLang = document.documentElement?.lang?.trim();
  if (htmlLang) {
    return { lang: primarySubtag(htmlLang), reliable: false, source: 'html-lang' };
  }

  return { lang: null, reliable: false, source: 'none' };
}

/** 给 hint 显示用的中文语言名（仅覆盖常见几种，未覆盖的回退到原码） */
export function languageLabelZh(lang: string | null): string {
  if (!lang) return '未知';
  const map: Record<string, string> = {
    zh: '中文',
    en: '英文',
    ja: '日文',
    ko: '韩文',
    fr: '法文',
    de: '德文',
    es: '西班牙文',
    it: '意大利文',
    pt: '葡萄牙文',
    ru: '俄文',
    ar: '阿拉伯文',
    vi: '越南文',
    th: '泰文',
  };
  return map[lang] ?? lang.toUpperCase();
}
