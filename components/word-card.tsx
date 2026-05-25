/**
 * WordCard —— 单词选区专用的"词典卡"。
 *
 * 位置：sidepanel scroll 区里、所有消息之前。随线程滚动（不固定），可折叠，
 * 默认展开。不是消息、不进 LLM —— 它是开场的确定性答案（IPA + 词典义），
 * 跟 Thread 的语境化解读分工互补。
 *
 * 数据来源：/api/lookup？word=<surfaceForm>，PRD §6.2 lemma → Free Dictionary →
 * LLM 兜底优先级。
 *
 * 视觉对齐 docs/sidepanel-main.jsx 里的 DictCard。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Volume2, Loader2, ChevronDown } from 'lucide-react';
import type { LookupResult, SelectionContext } from '@/lib/messaging';

interface WordCardProps {
  surfaceForm: string;
  backendUrl: string;
  /** 传入则后端 upsert + 落 EncounterEvent；不传走 GET 纯查询。 */
  selectionContext?: SelectionContext;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: LookupResult }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function WordCard({ surfaceForm, backendUrl, selectionContext }: WordCardProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [open, setOpen] = useState(true);
  const reqIdRef = useRef(0);
  /**
   * 切 open 时，先把当前 viewport.scrollTop 记下来，
   * 用 useLayoutEffect 在新 DOM 落版前一帧把 scrollTop 复位。
   *
   * 为什么需要：assistant-ui 的 `turnAnchor="top"` 在用户发过消息之后会
   * 维持"最近一条 user 消息钉在 viewport 顶端"——card 展开时它上方的
   * 内容高度变化会触发 ResizeObserver，assistant-ui 的 topAnchor reserve
   * apply() 重新计算 targetScrollTop，可能把 scrollTop 一把推到底，
   * 用户的体感就是"点了卡片瞬间跳到底"。
   *
   * 我们在 toggle 时显式快照 + 复位，让卡片自己撑开/收起、scroll 不动。
   * lastScrolledAnchorId 的去重逻辑保证 assistant-ui 不会反向再纠正一次。
   *
   * shouldRestoreRef.current = null 表示"本次 render 不需要复位"
   * （初次挂载、外部状态变化等场景不应跳）。只有 toggle handler 显式
   * 写入数字时才生效。
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setState({ kind: 'loading' });
    // 新词进来默认展开
    setOpen(true);
    const ctrl = new AbortController();

    const promise = selectionContext
      ? fetch(`${backendUrl}/api/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: surfaceForm, selectionContext }),
          signal: ctrl.signal,
        })
      : fetch(`${backendUrl}/api/lookup?word=${encodeURIComponent(surfaceForm)}`, {
          signal: ctrl.signal,
        });

    promise
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LookupResult;
      })
      .then((data) => {
        if (myReq !== reqIdRef.current) return;
        if (!data.partsOfSpeech || data.partsOfSpeech.length === 0) {
          setState({ kind: 'empty' });
          return;
        }
        setState({ kind: 'ready', data });
      })
      .catch((err: unknown) => {
        if (myReq !== reqIdRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'error', message: String(err) });
      });

    return () => ctrl.abort();
    // 用 ctx.id 字符串当 dep；对象 ref 每次反序列化都是新引用，会触发死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceForm, backendUrl, selectionContext?.id]);

  useLayoutEffect(() => {
    const pending = pendingScrollTopRef.current;
    pendingScrollTopRef.current = null;
    if (pending === null) return;
    const viewport = rootRef.current?.closest<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    if (!viewport) return;
    // 复位 + 多帧守护：assistant-ui 的 ResizeObserver 是 RAF 调度的，
    // 单帧复位偶尔会被它后续 apply 覆盖；连刷两帧把 scrollTop 锁住。
    viewport.scrollTop = pending;
    requestAnimationFrame(() => {
      viewport.scrollTop = pending;
      requestAnimationFrame(() => {
        viewport.scrollTop = pending;
      });
    });
  }, [open]);

  function toggle() {
    const viewport = rootRef.current?.closest<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    pendingScrollTopRef.current = viewport?.scrollTop ?? null;
    setOpen((o) => !o);
  }

  if (state.kind === 'loading') {
    return (
      <div className="rounded-[10px] border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          <span>查 "{surfaceForm}" 中…</span>
        </div>
      </div>
    );
  }
  if (state.kind === 'empty') return null;
  if (state.kind === 'error') {
    return (
      <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        查询失败：{state.message}
      </div>
    );
  }

  const { data } = state;
  const ipaText = formatIpa(data.ipa);

  return (
    <div ref={rootRef} className="overflow-hidden rounded-[10px] border bg-card">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {data.lemma}
        </span>
        {data.surfaceForm !== data.lemma && (
          <span className="text-[11px] text-muted-foreground/80">
            来自 "{data.surfaceForm}"
          </span>
        )}
        {data.estimated && (
          <span
            className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-300"
            title="LLM 估算（非真实词典条目）"
          >
            estimated
          </span>
        )}
        <span className="ml-auto inline-flex">
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {open && (
        <div className="px-3 pt-1 pb-3">
          <div className="mb-3 flex items-center gap-2">
            {ipaText && (
              <span className="font-mono text-[12.5px] text-foreground/85">{ipaText}</span>
            )}
            <PlayAudioButton word={data.lemma} audioUrl={data.audioUrl} />
          </div>

          {data.partsOfSpeech.map((p, i) => (
            <div key={`${p.pos}-${i}`} className="mb-3 last:mb-0">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {p.pos}
              </div>
              <ol className="space-y-2.5">
                {p.definitions.map((d, j) => (
                  <li key={j} className="flex gap-2 text-[12.5px] leading-snug">
                    <span className="shrink-0 text-muted-foreground/70">{j + 1}.</span>
                    <div className="min-w-0">
                      <div className="text-foreground">{d.definition}</div>
                      {d.cn && (
                        <div className="mt-[1px] text-foreground/70">{d.cn}</div>
                      )}
                      {d.example && (
                        <div className="mt-0.5 text-[12px] italic text-muted-foreground/80 leading-[1.55]">
                          — {d.example}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatIpa(ipa?: { us?: string; uk?: string }): string {
  if (!ipa) return '';
  if (ipa.us && ipa.uk && ipa.us !== ipa.uk) {
    return `US ${ipa.us}  UK ${ipa.uk}`;
  }
  return ipa.us ?? ipa.uk ?? '';
}

function PlayAudioButton({ word, audioUrl }: { word: string; audioUrl?: string }) {
  const [playing, setPlaying] = useState(false);

  function play() {
    setPlaying(true);
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => fallbackSpeak();
      audio.play().catch(() => fallbackSpeak());
      return;
    }
    fallbackSpeak();
  }

  function fallbackSpeak() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setPlaying(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(u);
  }

  return (
    <button
      type="button"
      onClick={play}
      disabled={playing}
      aria-label={`播放 ${word} 发音`}
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      <Volume2 className={`size-3.5 ${playing ? 'animate-pulse' : ''}`} />
    </button>
  );
}
