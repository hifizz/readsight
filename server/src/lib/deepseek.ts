/**
 * DeepSeek —— 翻译主 provider（国内 API，免代理）。
 *
 * 为什么选 DeepSeek：
 *   - 官方 API 在境内（api.deepseek.com），不走跨境网络，比 OpenRouter 稳。
 *   - 价格便宜：input cache-miss $0.14/M、cache-hit $0.0028/M、output $0.28/M
 *     —— 比 GLM 略贵但翻译质量明显更好，且对 JSON-only 输出协议更守规矩。
 *   - 命中国产内容审查时还有 OpenRouter 西方模型兜底（translate.ts 的 fallback 链）。
 *
 * 模型选择：对话固定 `deepseek-v4-pro`，翻译与词典固定
 * `deepseek-v4-flash`；两者都显式关闭 thinking。这样聊天升级不会改变
 * 机械文本任务的延迟、成本或翻译缓存行为。
 *
 * 协议：OpenAI-compatible。base URL: api.deepseek.com/v1
 *   key 形如 "sk-..."
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { fetch as undiciFetch } from 'undici';

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

export const DEEPSEEK_CHAT_MODEL_ID = 'deepseek-v4-pro';
export const DEEPSEEK_TEXT_MODEL_ID = 'deepseek-v4-flash';

/** 兼容既有翻译缓存/日志的 Flash 模型标识。 */
export const DEEPSEEK_MODEL_ID = DEEPSEEK_TEXT_MODEL_ID;

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

const deepseek = apiKey
  ? createOpenAICompatible({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey,
      fetch: fetchWithThinkingDisabled,
    })
  : null;

/** 高能力侧栏对话模型：V4 Pro，非 thinking。 */
export const deepseekV4ProChat: LanguageModel | null = deepseek
  ? deepseek(DEEPSEEK_CHAT_MODEL_ID)
  : null;

/** 翻译和词典使用的轻量文本模型：V4 Flash，非 thinking。 */
export const deepseekV4FlashText: LanguageModel | null = deepseek
  ? deepseek(DEEPSEEK_TEXT_MODEL_ID)
  : null;
