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

const apiKey = process.env.ZHIPU_API_KEY;

export function isZhipuConfigured(): boolean {
  return !!apiKey && apiKey.length > 0;
}

export const zhipuFlash: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'zhipu',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey,
    })('glm-4-flash')
  : null;
