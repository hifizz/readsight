/**
 * DeepSeek —— 翻译主 provider（国内 API，免代理）。
 *
 * 为什么选 DeepSeek：
 *   - 官方 API 在境内（api.deepseek.com），不走跨境网络，比 OpenRouter 稳。
 *   - `deepseek-chat` 是 V3 非推理模型，秒级响应；价格比 GLM 高但翻译质量
 *     明显更好，且对 JSON-only 输出协议更守规矩。
 *   - 跟 GLM 一样有国产内容审查，但触发频率低很多；命中时还有 OpenRouter
 *     西方模型兜底（translate.ts 的 fallback 链）。
 *
 * 协议：OpenAI-compatible。base URL: api.deepseek.com/v1
 *   key 形如 "sk-..."
 *
 * 注意：DeepSeek 还有个 `deepseek-reasoner` (R1) 是推理模型，会先吐
 * 大段 CoT 再给答案——慢 5-10×、花 token，不适合翻译。这里固定走
 * `deepseek-chat`。
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { fetch as undiciFetch } from 'undici';

const apiKey = process.env.DEEPSEEK_API_KEY;

export const DEEPSEEK_MODEL_ID = 'deepseek-chat';

export function isDeepseekConfigured(): boolean {
  return !!apiKey && apiKey.length > 0;
}

/**
 * 同样显式用 undici fetch，绕开 Next.js Turbopack patch 在并发下偶尔
 * 截断流的问题（zhipu / openrouter 那边吃过的坑）。
 */
export const deepseekChat: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey,
      fetch: undiciFetch as unknown as typeof globalThis.fetch,
    })(DEEPSEEK_MODEL_ID)
  : null;
