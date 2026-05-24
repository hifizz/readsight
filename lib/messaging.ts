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

export type BackgroundMessage =
  | { type: 'ASK_WITH_SELECTION'; payload: SelectionContext }
  | { type: 'SELECTION_READY'; payload: SelectionContext };

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
