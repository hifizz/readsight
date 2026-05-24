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
