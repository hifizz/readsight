/**
 * RecordsList —— Sidepanel "学习记录" tab 内容。
 *
 * 拉 /api/history，按 itemKey 聚合的列表卡片。每张卡：
 *   - 顶行：lemma + (surfaceForm) + 时间（右上角）
 *   - 中间：语境窗口（高亮 surfaceForm）—— 这是卡的真正营养
 *   - 底栏：域名 + 次数/事件 chip + "回原文"外链按钮
 *
 * 点条目 = 进入 chat tab + 加载对应 SelectionContext（App.tsx 接住）。
 * 视觉对齐 docs/RecordCard.jsx。
 */
import { useEffect, useState } from 'react';
import { Loader2, BookOpen, Globe, ExternalLink } from 'lucide-react';
import { windowAround } from '@/components/context-card';

export interface HistoryRecord {
  itemKey: string;
  lastSurfaceForm: string;
  lastTs: string;
  lastContextRef: string;
  totalCount: number;
  eventTypes: string[];
  /** 选区所在句子（M3 后端 LEFT JOIN selection_contexts 返回）；缺失时不渲染高亮窗口。 */
  lastSentence?: string | null;
  /** 原文 URL，用来抽 domain；缺失时显示 itemKey 的来源 fallback。 */
  lastUrl?: string | null;
}

const HL_BG = '#fdeeb8';
const HL_TEXT = '#5a4300';

const OUTCOME_TAG_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  still_unsure: { label: '待巩固', bg: '#faeeda', fg: '#854f0b' },
  understood: { label: '已懂', bg: '#e1f5ee', fg: '#0f6e56' },
  incorrect: { label: '答错', bg: '#fcebeb', fg: '#a32d2d' },
  correct: { label: '答对', bg: '#e1f5ee', fg: '#0f6e56' },
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  lookup: '查询',
  quick: '快捷',
  deepchat: '深聊',
  passive_reencounter: '复现',
};

interface RecordsListProps {
  backendUrl: string;
  onSelect: (record: HistoryRecord) => void;
  /** 每次切到 Records tab 时 +1，触发重新拉。 */
  refreshToken?: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; items: HistoryRecord[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function RecordsList({ backendUrl, onSelect, refreshToken = 0 }: RecordsListProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    const ctrl = new AbortController();
    fetch(`${backendUrl}/api/history?limit=50`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { items: HistoryRecord[] };
      })
      .then((data) => {
        if (!data.items || data.items.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', items: data.items });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'error', message: String(err) });
      });
    return () => ctrl.abort();
  }, [backendUrl, refreshToken]);

  if (state.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <BookOpen className="size-8 opacity-40" />
        <p className="text-sm">还没有学习记录</p>
        <p className="text-xs">在文章里划词查询 → 这里就会出现</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="p-3 text-xs text-destructive">加载失败：{state.message}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {state.items.map((r) => (
        <RecordCard key={r.itemKey} record={r} onSelect={onSelect} />
      ))}
    </div>
  );
}

function RecordCard({
  record,
  onSelect,
}: {
  record: HistoryRecord;
  onSelect: (r: HistoryRecord) => void;
}) {
  const [lemma] = record.itemKey.split('#');
  const win = windowAround(record.lastSentence ?? undefined, record.lastSurfaceForm);
  const domain = record.lastUrl ? extractDomain(record.lastUrl) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(record)}
      className="group rounded-[11px] border bg-card p-3 text-left transition-colors hover:bg-muted/40"
    >
      {/* 词 + 时间 */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[14px] font-semibold tracking-tight text-foreground">
            {lemma}
          </span>
          {record.lastSurfaceForm !== lemma && (
            <span className="text-[11.5px] text-muted-foreground/80">
              ({record.lastSurfaceForm})
            </span>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground/80">
          {formatRelativeTime(record.lastTs)}
        </span>
      </div>

      {/* 语境：开窗 + 高亮 surfaceForm（卡片的真正营养）*/}
      {win && win.match && (
        <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-[1.55] text-muted-foreground">
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

      {/* 细 meta：域名 + 事件 chip + 回原文 */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {domain && (
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/80">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{domain}</span>
            </span>
          )}
          {renderTags(record)}
        </div>
        <span
          aria-label="回原文"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors group-hover:bg-background group-hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

function renderTags(r: HistoryRecord) {
  const tags: Array<{ key: string; label: string; outcome?: keyof typeof OUTCOME_TAG_LABEL }> = [
    { key: 'count', label: `${r.totalCount} 次` },
  ];
  for (const t of r.eventTypes) {
    const label = EVENT_TYPE_LABEL[t] ?? t;
    tags.push({ key: t, label });
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      {tags.map((t) => (
        <span
          key={t.key}
          className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {t.label}
        </span>
      ))}
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

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
