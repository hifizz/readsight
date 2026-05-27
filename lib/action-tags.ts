/**
 * popup + sidepanel suggestion 共用的按钮元数据。
 * 类型定义在 `lib/messaging.ts`（ActionTag），这里只是 UI 配套。
 *
 * 跟 `server/src/lib/action-tags.ts` 协同 —— 服务端按 tag 切系统提示；这里按
 * type 决定显哪几个按钮 + 按钮 label。改这里时务必同步那边。
 */
import type { ActionTag, SelectionType } from './messaging';

export interface ActionDef {
  tag: ActionTag;
  label: string;
}

/** 词/短语 4 按钮、句/多句 4 按钮（PRD §8.1） */
export function actionsForSelectionType(t: SelectionType): ActionDef[] {
  if (t === 'word' || t === 'phrase') {
    return [
      { tag: 'meaning', label: '词义' },
      { tag: 'pronunciation', label: '发音' },
      { tag: 'sentence-translate', label: '本句译法' },
      { tag: 'usage', label: '用法搭配' },
    ];
  }
  // 翻句不在这里 —— sentence/multi 打开 popup 自动翻译，不需要按钮触发
  return [
    { tag: 'grammar', label: '析语法' },
    { tag: 'rewrite', label: '改写地道说法' },
    { tag: 'hard-parts', label: '难点定位' },
  ];
}

/** 代用户发的那条 user 消息文本 —— 用 label 在 chat 历史里好看 */
export function userMessageForActionTag(tag: ActionTag): string {
  switch (tag) {
    case 'meaning':
      return '词义';
    case 'pronunciation':
      return '发音';
    case 'sentence-translate':
      return '本句译法';
    case 'usage':
      return '用法搭配';
    case 'translate':
      return '翻句';
    case 'grammar':
      return '析语法';
    case 'rewrite':
      return '改写地道说法';
    case 'hard-parts':
      return '难点定位';
  }
}
