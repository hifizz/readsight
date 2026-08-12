/**
 * ContextCard —— 顶部钉住的"这条线程在聊什么"语境卡。
 *
 * 位置：sidepanel header/tab 之下、scroll 区之上，不进消息流，不发 LLM。
 * 内容：来源域名（细眉）+ 类型徽章 + 选中文本 + 语境窗口（高亮选中文本）。
 *
 * 视觉对齐 docs/ContextCard.jsx。颜色用项目 tailwind token；
 * 高亮（黄底+棕字）是设计的核心信号，inline style 保留具体色值。
 */
import { Globe, X } from 'lucide-react';
import type { SelectionContext, SelectionType } from '@/lib/messaging';
import { Button } from '@/components/ui/button';
import { SpeakButton } from '@/components/speak-button';

const TYPE_LABEL: Record<SelectionType, string> = {
  word: '词',
  phrase: '短语',
  sentence: '句',
  multi: '段落',
};

const HL_BG = '#fdeeb8';
const HL_TEXT = '#5a4300';

interface ContextCardProps {
  ctx: SelectionContext;
  onClear?: () => void;
}

export function ContextCard({ ctx, onClear }: ContextCardProps) {
  const { selection, source, context } = ctx;
  const domain = extractDomain(source.url);
  const win = windowAround(context.sentence || context.paragraph, selection.text);
  const isShort = selection.type === 'word' || selection.type === 'phrase';
  // 选中单词时，上方朗读本句；下方 WordCard 仍保留单词发音，两种朗读同时可用。
  const speechText = selection.type === 'word'
    ? context.sentence || context.paragraph || selection.text
    : selection.text;

  return (
    <div className="shrink-0 border-b bg-muted/40 px-3.5 py-2.5">
      {/* 来源眉：域名（最轻） */}
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
        <div className="flex min-w-0 items-center gap-1">
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{domain}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <SpeakButton text={speechText} />
          {onClear && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={onClear}
              aria-label="Clear selection context"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* 选区行：类型徽章 + 选中文本 */}
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
          {TYPE_LABEL[selection.type] ?? selection.type}
        </span>
        <span
          className={`line-clamp-2 font-semibold leading-snug text-foreground ${
            isShort ? 'text-[15px]' : 'text-[13px]'
          }`}
        >
          {selection.text}
        </span>
      </div>

      {/* 语境窗口：高亮选中、开窗两行 */}
      {win && win.match && (
        <div className="mt-1.5 line-clamp-2 text-[12px] leading-[1.55] text-muted-foreground">
          {win.lead && '… '}
          {win.pre}
          <span
            className="rounded-[3px] px-[2px] font-semibold"
            style={{ background: HL_BG, color: HL_TEXT }}
          >
            {win.match}
          </span>
          {win.post}
          {win.trail && ' …'}
        </div>
      )}
    </div>
  );
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 用 anchor.quote 的思路开窗：选中文本前后各截一段，两端补 …，
 * 在 word break 处对齐，避免截在词中间。
 */
export function windowAround(
  context: string | undefined,
  selection: string | undefined,
  before = 52,
  after = 56,
): { lead: boolean; pre: string; match: string; post: string; trail: boolean } | null {
  if (!context || !selection) return null;
  const lc = context.toLowerCase();
  const idx = lc.indexOf(selection.toLowerCase());
  if (idx === -1) {
    return { lead: false, pre: context, match: '', post: '', trail: false };
  }
  const start = idx;
  const end = idx + selection.length;

  let preStart = Math.max(0, start - before);
  if (preStart > 0) {
    const sp = context.indexOf(' ', preStart);
    if (sp !== -1 && sp < start) preStart = sp + 1;
  }
  let postEnd = Math.min(context.length, end + after);
  if (postEnd < context.length) {
    const sp = context.lastIndexOf(' ', postEnd);
    if (sp !== -1 && sp > end) postEnd = sp;
  }

  return {
    lead: preStart > 0,
    pre: context.slice(preStart, start),
    match: context.slice(start, end),
    post: context.slice(end, postEnd),
    trail: postEnd < context.length,
  };
}
