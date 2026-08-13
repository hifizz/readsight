/**
 * WordCard —— 单词选区专用的"词典卡"外壳（sidepanel 用）。
 *
 * 位置：sidepanel scroll 区里、所有消息之前。随线程滚动（不固定），可折叠，
 * 默认展开。不是消息、不进 LLM —— 它是开场的确定性答案（IPA + 词典义），
 * 跟 Thread 的语境化解读分工互补。
 *
 * 内容由共享 DictCard（rich 模式）渲染 —— 与 popup 的视觉语言一致，包含 IPA、
 * 屈折形关系卡、编号释义列表、例句、CET/TOEFL tag chip、Collins 星、形态变化表。
 * 本文件只管"外壳"：lemma 头部 + 折叠交互 + loading/error/empty 状态 +
 * 跟 assistant-ui scroll 协作的 anchor 保护。
 *
 * 数据来源：/api/lookup？word=<surfaceForm>，server 端 cache → ECDICT →
 * Free Dictionary → LLM 兜底（PRD §6.2）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import type { LookupResult, SelectionContext } from '@/lib/messaging';
import { DictCard, DICT_CARD_CSS } from '@/components/dict-card';
import { authFetch } from '@/lib/auth';

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
  const [speaking, setSpeaking] = useState(false);
  const reqIdRef = useRef(0);
  /**
   * 切 open 时，先把当前 viewport.scrollTop 记下来，
   * 用 useLayoutEffect 在新 DOM 落版前一帧把 scrollTop 复位。
   *
   * 为什么需要：assistant-ui 的 `turnAnchor="top"` 在用户发过消息之后会
   * 维持"最近一条 user 消息钉在 viewport 顶端"——card 展开时它上方的
   * 内容高度变化会触发 ResizeObserver，可能把 scrollTop 一把推到底，
   * 用户的体感就是"点了卡片瞬间跳到底"。
   *
   * 我们在 toggle 时显式快照 + 复位，让卡片自己撑开/收起、scroll 不动。
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setState({ kind: 'loading' });
    setOpen(true);
    const ctrl = new AbortController();

    const promise = selectionContext
      ? authFetch(`${backendUrl}/api/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: surfaceForm, selectionContext }),
          signal: ctrl.signal,
        })
      : authFetch(`${backendUrl}/api/lookup?word=${encodeURIComponent(surfaceForm)}`, {
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

  // 切换 surfaceForm 时停掉发音（避免上一个词的音播到下一个词）
  useEffect(() => {
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceForm]);

  function handleSpeak() {
    if (state.kind !== 'ready') return;
    const data = state.data;
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    // Tier 1：优先用 Free Dictionary 给的真人音频；失败 fallback 浏览器 TTS
    if (data.audioUrl) {
      const audio = new Audio(data.audioUrl);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => fallbackTTS(data.lemma);
      audio.play().catch(() => fallbackTTS(data.lemma));
      return;
    }
    fallbackTTS(data.lemma);
  }

  function fallbackTTS(word: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
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

  return (
    <div ref={rootRef} className="overflow-hidden rounded-[10px] border bg-card">
      {/* DictCard 的 CSS 一次注入 —— `.eag-dict-card` 命名空间，不外泄。 */}
      <style>{DICT_CARD_CSS}</style>

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
        <span className="ml-auto inline-flex">
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {open && (
        <div className="px-3 pt-2.5 pb-3">
          <DictCard
            mode="rich"
            data={data}
            speaking={speaking}
            onSpeak={handleSpeak}
          />
        </div>
      )}
    </div>
  );
}
