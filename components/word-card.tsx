/**
 * WordCard —— 单词选区专用的"词典卡"。
 *
 * 何时出现：
 *   sidepanel 检测到 `selection.type === 'word'` 时挂载在 ContextCard 和
 *   assistant-ui Thread 之间。其他选区类型（phrase / sentence / multi）
 *   不渲染这个组件。
 *
 * 数据来源：
 *   /api/lookup?word=<surfaceForm>，后端按 PRD §6.2 走 lemma 还原 →
 *   Free Dictionary → LLM 兜底的优先级，前端只消费结果。
 *
 * 与 assistant-ui Thread 的分工：
 *   WordCard = 确定性字典金标准（IPA / 词性 / 本意）。
 *   Thread = LLM 给的"在这一句里的特殊用法"语境化解读。
 *   两者并存，不重叠。后端 system prompt 已经知道这个分工，会主动避开重复词典义。
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import type { LookupResult } from '@/lib/messaging';
import { Button } from '@/components/ui/button';

interface WordCardProps {
  /** 用户实际选中的形态，例如 "outed"。 */
  surfaceForm: string;
  /** 后端 base URL，由 sidepanel 传入避免再读一次 env。 */
  backendUrl: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: LookupResult }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function WordCard({ surfaceForm, backendUrl }: WordCardProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // surfaceForm 变了就发新请求；用 ref 跟踪上一次的 surfaceForm 把过期响应丢掉。
  const reqIdRef = useRef(0);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setState({ kind: 'loading' });
    const ctrl = new AbortController();

    fetch(
      `${backendUrl}/api/lookup?word=${encodeURIComponent(surfaceForm)}`,
      { signal: ctrl.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LookupResult;
      })
      .then((data) => {
        if (myReq !== reqIdRef.current) return; // 过期响应丢弃
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
  }, [surfaceForm, backendUrl]);

  if (state.kind === 'loading') {
    return (
      <div className="border-b bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          <span>looking up "{surfaceForm}"…</span>
        </div>
      </div>
    );
  }

  if (state.kind === 'empty') {
    // 词典 + LLM 都没给出可用条目（极少：可能是符号 / 空白）。静默隐藏。
    return null;
  }

  if (state.kind === 'error') {
    return (
      <div className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
        lookup failed: {state.message}
      </div>
    );
  }

  const { data } = state;
  const ipaText = formatIpa(data.ipa);

  return (
    <div className="border-b bg-card px-3 py-3 text-xs">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight">{data.lemma}</span>
        {data.surfaceForm !== data.lemma && (
          <span className="text-muted-foreground">
            (from "<span className="font-medium">{data.surfaceForm}</span>")
          </span>
        )}
        {data.estimated && (
          <span
            className="ml-auto rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-300"
            title="LLM-estimated (not from dictionary)"
          >
            estimated
          </span>
        )}
      </div>

      <div className="mb-2 flex items-center gap-2">
        {ipaText && (
          <span className="font-mono text-muted-foreground">{ipaText}</span>
        )}
        <PlayAudioButton word={data.lemma} audioUrl={data.audioUrl} />
      </div>

      <div className="space-y-1.5">
        {data.partsOfSpeech.map((p, i) => (
          <div key={`${p.pos}-${i}`}>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {p.pos}
            </div>
            <ol className="ml-3 list-decimal space-y-0.5 text-foreground">
              {p.definitions.map((d, j) => (
                <li key={j}>
                  <span>{d.definition}</span>
                  {d.example && (
                    <div className="text-muted-foreground italic">
                      — {d.example}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
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

/**
 * 优先放词典真人音频（PRD §6.3 tier 1），失败 / 没有则回退浏览器
 * SpeechSynthesis（tier 0，零成本、机械感）。
 */
function PlayAudioButton({
  word,
  audioUrl,
}: {
  word: string;
  audioUrl?: string;
}) {
  const [playing, setPlaying] = useState(false);

  function play() {
    setPlaying(true);
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => {
        // 真人音频加载失败 → tier 0 兜底
        fallbackSpeak();
      };
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
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={play}
      disabled={playing}
      aria-label={`Play pronunciation of ${word}`}
    >
      <Volume2 className={`size-3.5 ${playing ? 'animate-pulse' : ''}`} />
    </Button>
  );
}
