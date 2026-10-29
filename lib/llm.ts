/**
 * 浏览器里的模型工厂。替代 server/src/lib/deepseek.ts。
 * undici 不再需要：那是为了绕开 Next 对 fetch 的 patch。
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { getLLMConfig, type LLMConfig } from '@/lib/llm-config';

export class NoKeyError extends Error {
  constructor() {
    super('尚未配置 API Key');
    this.name = 'NoKeyError';
  }
}

export function isNoKeyError(err: unknown): boolean {
  return err instanceof NoKeyError || (err instanceof Error && err.name === 'NoKeyError');
}

/**
 * DeepSeek 的 thinking 字段没有 AI SDK 的 extra body 钩子，在 fetch 层改 JSON。
 * 只在用户打开「关闭 thinking」时注入，避免打到别的厂商被拒。
 */
export function withThinkingDisabled(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (body && typeof body === 'object') {
          body.thinking = { type: 'disabled' };
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        /* 非 JSON body 保持原样 */
      }
    }
    return baseFetch(input, init);
  };
}

export async function hasApiKey(): Promise<boolean> {
  const config = await getLLMConfig();
  return config.apiKey.length > 0;
}

export async function getModels(): Promise<{
  chat: LanguageModel;
  text: LanguageModel;
  config: LLMConfig;
}> {
  const config = await getLLMConfig();
  if (!config.apiKey) throw new NoKeyError();
  if (!config.baseURL) throw new Error('尚未配置 Base URL');
  const provider = createOpenAICompatible({
    name: 'byok',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: { 'X-Title': 'Readsight' },
    // 保持 false：true 会发 json_schema，DeepSeek 兼容协议只接受 json_object。
    // 用户开关决定我们走不走 Output.object（json_object），不打开这条。
    supportsStructuredOutputs: false,
    fetch: config.disableThinking ? withThinkingDisabled(globalThis.fetch.bind(globalThis)) : undefined,
  });
  return {
    chat: provider.chatModel(config.chatModel),
    text: provider.chatModel(config.textModel),
    config,
  };
}
