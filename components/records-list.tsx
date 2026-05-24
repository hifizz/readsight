/**
 * RecordsList —— Sidepanel "学习记录" tab 内容。
 *
 * 拉 `/api/history`，按 itemKey 聚合的列表卡片：surfaceForm 大字 +
 * lemma#pos 小字 + 次数 badge + 最近时间相对值 + 事件类型 chips。
 *
 * 点条目触发 onSelect(record)，由 App.tsx 接住 → 切回 Chat tab +
 * 加载对应 SelectionContext 到顶部语境卡。
 */
import { useEffect, useState } from 'react';
import { Loader2, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface HistoryRecord {
  itemKey: string;
  lastSurfaceForm: string;
  lastTs: string;
  lastContextRef: string;
  totalCount: number;
  eventTypes: string[];
}

interface RecordsListProps {
  backendUrl: string;
  onSelect: (record: HistoryRecord) => void;
  /** 用于触发刷新（每次切到 Records tab 时 +1）。 */
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
      <div className="p-3 text-xs text-destructive">
        加载失败：{state.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
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
  const [lemma, pos] = record.itemKey.split('#');
  return (
    <button
      type="button"
      onClick={() => onSelect(record)}
      className="group flex flex-col gap-1 rounded-md border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold tracking-tight">
            {record.lastSurfaceForm}
          </span>
          {record.lastSurfaceForm !== lemma && (
            <span className="ml-1.5 text-muted-foreground">
              ({lemma})
            </span>
          )}
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {pos}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatRelativeTime(record.lastTs)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="h-5 text-[10px]">
          {record.totalCount} 次
        </Badge>
        {record.eventTypes.map((t) => (
          <Badge
            key={t}
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-normal"
          >
            {t}
          </Badge>
        ))}
      </div>
    </button>
  );
}

/**
 * 简单的"刚刚 / 2h ago / 3d ago"格式化，避免引入 date-fns（~50KB gzip）。
 */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
