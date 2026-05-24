/**
 * SpeakButton —— 句子 / 短语级 TTS（PRD §6.3 Tier 2）。
 *
 * 行为：
 *   1. 点击 → 调 /api/tts → 收到 mp3 blob → `new Audio` 播放
 *   2. 播放中点击 → 暂停 + 回 idle
 *   3. /api/tts 失败（网络 / MiniMax 配额）→ 自动 fallback 到浏览器
 *      speechSynthesis (PRD §6.3 Tier 0)
 *
 * 后端缓存了同 text+voice+model 的 hex 音频，第二次点同一句话约 30ms 秒回。
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2, Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

type State = 'idle' | 'loading' | 'playing' | 'error';

interface SpeakButtonProps {
  text: string;
  backendUrl: string;
}

export function SpeakButton({ text, backendUrl }: SpeakButtonProps) {
  const [state, setState] = useState<State>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // unmount 时清音频和 blob URL，避免 dom-detached audio 还在响 + URL leak
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      // 兜底取消 speechSynthesis 的回放
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function fallbackSpeak() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setState('error');
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.onstart = () => setState('playing');
    u.onend = () => setState('idle');
    u.onerror = () => setState('error');
    window.speechSynthesis.speak(u);
  }

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState('idle');
  }

  async function play() {
    if (state === 'playing') {
      stop();
      return;
    }
    if (state === 'loading') return;

    setState('loading');
    try {
      const res = await fetch(
        `${backendUrl}/api/tts?text=${encodeURIComponent(text)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => setState('playing');
      audio.onended = () => {
        URL.revokeObjectURL(url);
        blobUrlRef.current = null;
        audioRef.current = null;
        setState('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        blobUrlRef.current = null;
        audioRef.current = null;
        setState('error');
      };
      await audio.play();
    } catch (err) {
      console.warn('[tts] /api/tts failed, falling back to speechSynthesis', err);
      fallbackSpeak();
    }
  }

  const Icon = state === 'loading' ? Loader2 : state === 'playing' ? Square : Volume2;
  const tooltip =
    state === 'playing' ? 'Stop' : state === 'loading' ? 'Loading…' : 'Listen';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={play}
      disabled={state === 'loading'}
      aria-label={tooltip}
      title={tooltip}
    >
      <Icon
        className={`size-3.5 ${state === 'loading' ? 'animate-spin' : ''} ${
          state === 'error' ? 'text-destructive' : ''
        }`}
      />
    </Button>
  );
}
