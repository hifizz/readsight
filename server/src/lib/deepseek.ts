/**
 * DeepSeek —— 翻译主 provider（国内 API，免代理）。
 *
 * 为什么选 DeepSeek：
 *   - 官方 API 在境内（api.deepseek.com），不走跨境网络，比 OpenRouter 稳。
 *   - 价格便宜：input cache-miss $0.14/M、cache-hit $0.0028/M、output $0.28/M
 *     —— 比 GLM 略贵但翻译质量明显更好，且对 JSON-only 输出协议更守规矩。
 *   - 命中国产内容审查时还有 OpenRouter 西方模型兜底（translate.ts 的 fallback 链）。
 *
 * 模型选择：`deepseek-v4-flash` + 显式关 thinking。
 *   - V4-flash 是 deepseek-chat / deepseek-reasoner 的统一接班者，
 *     默认 thinking=enabled（=reasoner 行为：先吐 CoT 再给答案），
 *     非 thinking 等价于旧 deepseek-chat。
 *   - 翻译是机械任务，CoT 推理只会烧 token 不提质量，必须关。
 *   - V4-pro 比 flash 贵 3×（output $0.87/M），翻译用例没必要。
 *
 * 协议：OpenAI-compatible。base URL: api.deepseek.com/v1
 *   key 形如 "sk-..."
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { fetch as undiciFetch } from 'undici';

const apiKey = process.env.DEEPSEEK_API_KEY;

export const DEEPSEEK_MODEL_ID = 'deepseek-v4-flash';

export function isDeepseekConfigured(): boolean {
  return !!apiKey && apiKey.length > 0;
}

/**
 * 自定义 fetch：
 *   1. 用 undici 绕开 Next.js Turbopack 对全局 fetch 的 patch（并发下偶尔截断流）
 *   2. 注入 thinking: { type: 'disabled' } —— AI SDK v6 的 openai-compatible
 *      没有原生 "extraBody" 钩子，最稳的注入点就是在 fetch 层改 JSON body
 */
const fetchWithThinkingDisabled: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      body.thinking = { type: 'disabled' };
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      /* 非 JSON body 不动；正常路径都是 JSON */
    }
  }
  return undiciFetch(input as never, init as never) as unknown as ReturnType<typeof fetch>;
};

export const deepseekChat: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey,
      fetch: fetchWithThinkingDisabled,
    })(DEEPSEEK_MODEL_ID)
  : null;
