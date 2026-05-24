/**
 * 智谱清言（Zhipu）GLM-4-Flash —— 翻译 / 短文本任务专用的真小快模型。
 *
 * 为什么不沿用 MiniMax：
 *   - MiniMax 当前 plan 解锁的只有 M2 系列大 thinking 模型。`-highspeed`
 *     只是关掉 CoT，不是变小，依然慢；其他小模型 (abab / Text-01 / M1)
 *     全部 "your current token plan not support"。
 *   - GLM-4-Flash 是智谱官方明确标"Flash"的小模型，~200-400ms 响应，
 *     完全免费、永久免费、无量级限制（截至 2026-05），适合机械翻译。
 *
 * 协议：OpenAI-compatible。base URL: open.bigmodel.cn/api/paas/v4。
 *   key 形如 "xxxxxxxx.xxxxxxxx"（智谱用 . 分隔 issuer/secret）。
 *
 * 配置：`ZHIPU_API_KEY` 没设的话 `isZhipuConfigured()` 返 false，
 *   lookup.ts 会自动跳过 Zhipu 直接走 MiniMax fallback。
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
