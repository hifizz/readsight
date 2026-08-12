/**
 * 智谱清言（Zhipu）GLM-4-Flash —— 全文翻译兜底模型。
 *
 * GLM-4-Flash 是智谱的小模型，适合在 DeepSeek 主翻失败后处理机械翻译。
 *
 * 协议：OpenAI-compatible。base URL: open.bigmodel.cn/api/paas/v4。
 *   key 形如 "xxxxxxxx.xxxxxxxx"（智谱用 . 分隔 issuer/secret）。
 *
 * 配置：`ZHIPU_API_KEY` 没设的话 `isZhipuConfigured()` 返 false，
 *   全文翻译链会自动跳过该 provider。
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { fetch as undiciFetch } from 'undici';

const apiKey = process.env.ZHIPU_API_KEY;

export function isZhipuConfigured(): boolean {
  return !!apiKey && apiKey.length > 0;
}

/**
 * 关键：显式注入 undici.fetch，绕开 Next.js Turbopack 对 globalThis.fetch
 * 的 cache instrumentation。实测发现 Next dev 模式下并发 4× generateText
 * 通过 patched fetch 会截断响应（中文 JSON 串到 19 字符就被切），
 * 但同样代码在独立 node 进程下完全正常。换 undici 的原生 fetch 之后
 * 4 并发能稳定 1-2s 全部命中。
 */
export const zhipuFlash: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'zhipu',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey,
      fetch: undiciFetch as unknown as typeof globalThis.fetch,
    })('glm-4-flash')
  : null;
