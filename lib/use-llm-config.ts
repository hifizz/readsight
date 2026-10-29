import { useEffect, useState } from 'react';
import {
  DEFAULT_LLM_CONFIG,
  getLLMConfig,
  subscribeLLMConfig,
  type LLMConfig,
} from '@/lib/llm-config';

export function useLLMConfig(): { config: LLMConfig; ready: boolean } {
  const [config, setConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getLLMConfig().then((next) => {
      if (cancelled) return;
      setConfig(next);
      setReady(true);
    });
    const unsubscribe = subscribeLLMConfig((next) => setConfig(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return { config, ready };
}
