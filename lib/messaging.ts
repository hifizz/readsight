// 跨 context（content / background / sidepanel）共享的消息类型与 SelectionContext schema。
// 对应 PRD §5.1。前端这边字段命名按 TS 习惯保持 camelCase；后端 Drizzle schema 用
// snake_case 列名，差异在后端落库时映射。

export type SelectionType = 'word' | 'phrase' | 'sentence' | 'multi';

export interface SelectionContext {
  id: string;
  capturedAt: string;
  source: {
    url: string;
    title: string;
    siteId: string;
    heading?: string;
  };
  selection: {
    text: string;
    type: SelectionType;
    range: [start: number, end: number];
  };
  context: {
    sentence: string;
    paragraph: string;
  };
  anchor: {
    quote: { exact: string; prefix: string; suffix: string };
    blockIndex?: number;
  };
}

/**
 * popup 快捷按钮 + 自由输入对应的 actionTag（PRD §8.1）。
 * 跟 `server/src/lib/action-tags.ts` 同步；改这里时记得同步那边。
 */
export type ActionTag =
  | 'meaning'
  | 'pronunciation'
  | 'sentence-translate'
  | 'usage'
  | 'translate'
  | 'grammar'
  | 'rewrite'
  | 'hard-parts';

/** popup → background → sidepanel 的语境投递；可附带"代用户发"的指令 */
export interface AskWithSelectionPayload {
  ctx: SelectionContext;
  /** 代用户按 actionTag 发一条消息（popup 4 个快捷按钮用） */
  actionTag?: ActionTag;
  /** 代用户发一条自由文本消息（popup 输入框 + Enter / 深聊用） */
  initialMessage?: string;
}

export type BackgroundMessage =
  | { type: 'ASK_WITH_SELECTION'; payload: AskWithSelectionPayload }
  | { type: 'SELECTION_READY'; payload: AskWithSelectionPayload }
  /** Content script 扫描发现的被动重逢命中（PRD §5.2）；background 转发到 /api/encounter */
  | { type: 'PASSIVE_HITS'; payload: Array<{ surfaceForm: string; lemma: string }> }
  /** Sidepanel 点 records 条目 → 让 background 找到原文 tab 触发高亮（PRD §8.3） */
  | { type: 'HIGHLIGHT_REQUEST'; payload: { url: string; anchor: SelectionContext['anchor'] } }
  /** Background → content script：在当前 tab 的页面上高亮 anchor 指向的文本 */
  | { type: 'HIGHLIGHT_ANCHOR'; payload: SelectionContext['anchor'] }
  /** Content → background：批量翻译一组段落，sendResponse 返结果（一次往返） */
  | {
      type: 'TRANSLATE_BLOCKS';
      payload: { blocks: Array<{ id: string; text: string }> };
    }
  /** Background → content script：右键菜单 / 快捷键触发的"开关全文翻译" */
  | { type: 'TOGGLE_TRANSLATE' }
  /** Background → content script：右键菜单"翻译选中内容"触发，让 content 重抓 selection 打开 Dialog */
  | { type: 'TRANSLATE_SELECTION' }
  /** Background → content script：右键菜单"重置本站翻译规则"，通用恢复入口（含 never→可见） */
  | { type: 'RESET_DOMAIN_RULE' }
  /** Content → background：翻译状态切换通知，让 background 更新右键菜单标题 */
  | { type: 'TRANSLATE_STATE_CHANGED'; payload: { active: boolean } };

/** /api/translate 单块结果 —— 跟后端 route 返回 shape 同步。 */
export interface TranslationResult {
  id: string;
  zh: string;
  source: 'cache' | 'llm';
  error?: string;
}

/**
 * `/api/lookup` 返回结构。前端 WordCard 直接吃这个 shape；后端缓存表也存这个。
 *
 * - surfaceForm: 用户实际选中的形态（"outed"）
 * - lemma: 经过 wink-lemmatizer 还原的字典原形（"out"）
 * - ipa: IPA 音标，分美式英式两版（词典源若只提供一种就缺一项）
 * - audioUrl: 真人音频，PRD §6.3 tier 1；前端 fallback 到 SpeechSynthesis (tier 0)
 * - partsOfSpeech: 一个词可能有多种词性（"run" 是动词也是名词），每种带定义 + 例句
 * - source / estimated: 来源透明，LLM 兜底时 estimated=true（PRD §6.2）
 */
export interface LookupResult {
  surfaceForm: string;
  lemma: string;
  /** PRD §5.2 itemKey = `${lemma}#${pos}`，EncounterEvent 用来串起跨次查询。 */
  itemKey: string;
  ipa?: { us?: string; uk?: string };
  audioUrl?: string;
  partsOfSpeech: Array<{
    pos: string;
    // cn: 中文释义（D 方案：Free Dictionary 命中后用 MiniMax 批量翻一份和缓存共存）。
    // 老缓存条目可能没这个字段，前端容忍 undefined。
    definitions: Array<{ definition: string; cn?: string; example?: string }>;
  }>;
  source: 'cache' | 'free-dictionary' | 'llm';
  estimated?: boolean;
}
