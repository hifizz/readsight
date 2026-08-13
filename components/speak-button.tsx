/**
 * SpeakButton —— 句子 / 短语级浏览器语音播放。
 *
 * 直接使用 speechSynthesis，不依赖后端语音服务。
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

type State = 'idle' | 'playing' | 'error';

interface SpeakButtonProps {
  text: string;
}

export function SpeakButton({ text }: SpeakButtonProps) {
  const [state, setState] = useState<State>('idle');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // 组件移除后取消正在播放的语音，避免离开相关 UI 后继续出声。
  useEffect(() => {
    return () => {
      const utterance = utteranceRef.current;
      utteranceRef.current = null;
      if (utterance) {
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function stop() {
    const utterance = utteranceRef.current;
    utteranceRef.current = null;
    if (utterance) {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState('idle');
  }

  function play() {
    if (state === 'playing' || utteranceRef.current) {
      stop();
      return;
    }

    const trimmed = text.trim();
    if (
      !trimmed ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      setState('error');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = 'en-US';
    utterance.onstart = () => {
      if (utteranceRef.current === utterance) setState('playing');
    };
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setState('idle');
    };
    utterance.onerror = (event) => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      console.warn('[speech] browser speech synthesis failed', event.error);
      setState('error');
    };

    utteranceRef.current = utterance;
    setState('playing');
    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      utteranceRef.current = null;
      console.warn('[speech] browser speech synthesis failed', err);
      window.speechSynthesis.cancel();
      setState('error');
    }
  }

  const Icon = state === 'playing' ? Square : Volume2;
  const tooltip =
    state === 'playing'
      ? 'Stop'
      : state === 'error'
        ? 'Unable to play speech'
        : 'Listen';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={play}
      aria-label={tooltip}
      title={tooltip}
    >
      <Icon
        className={`size-3.5 ${state === 'error' ? 'text-destructive' : ''}`}
      />
    </Button>
  );
}
