/**
 * OpenRouter（https://openrouter.ai/）—— 用于翻译的"非中国区"LLM provider。
 *
 * 为什么接入：
 *   Zhipu GLM-4-Flash 翻译质量好且免费，但中国 LLM 都内置内容审查，
 *   遇到政治 / 军事 / 部分品牌名等会返"系统检测到敏感内容"硬拒。
 *   OpenRouter 接的是 Llama / Gemini / Qwen 等西方模型，没这套过滤，
 *   正好做 content_filtered 段落的 fallback 翻译。
 *
 * 协议：OpenAI-compatible。base URL: openrouter.ai/api/v1
 * 注册：openrouter.ai/keys → 拿 sk-or-v1-... 的 key
 * 免费模型清单：openrouter.ai/models?q=free
 *
 * 默认模型：meta-llama/llama-3.3-70b-instruct:free —— 70B 参数 + 免费 +
 * 多语言能力，对英→中翻译质量足够。可通过 OPENROUTER_MODEL 环境变量
 * 切换到 google/gemini-2.0-flash-exp:free 或其他免费 ID。
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetch as undiciFetch } from 'undici';
import type { LanguageModel } from 'ai';

const apiKey = process.env.OPENROUTER_API_KEY;

/** 实际跑的模型 ID（也作为缓存/日志里的 model 字段值） */
export const OPENROUTER_MODEL_ID =
  process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free';

export function isOpenrouterConfigured(): boolean {
  return !!apiKey && apiKey.length > 0;
}

/**
 * OpenRouter 推荐在请求里带 HTTP-Referer + X-Title，用于他们 free tier
 * 的 ranking / abuse 跟踪。不是强制但加上更稳。
 *
 * 跟 Zhipu 那边一样显式用 undici fetch 绕开 Next.js Turbopack 的 fetch
 * patch 在并发下偶发截断响应的问题。
 */
export const openrouterModel: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      fetch: undiciFetch as unknown as typeof globalThis.fetch,
      headers: {
        'HTTP-Referer': 'https://github.com/readsight',
        'X-Title': 'Readsight',
      },
    })(OPENROUTER_MODEL_ID)
  : null;
