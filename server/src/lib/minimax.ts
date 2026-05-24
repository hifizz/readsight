import { createMinimax } from 'vercel-minimax-ai-provider';

// MiniMax 有两个地域：
//   - 国际区  api.minimax.io   （provider 默认）
//   - 中国区  api.minimaxi.com （注意末尾的 i；platform.minimaxi.com 上签发的 key 走这里）
// 我们这把开发 key 是 minimaxi.com 签的，必须显式指向 China baseURL；
// 路径保持 provider 的 Anthropic-format 默认 (/anthropic/v1)。
export const minimax = createMinimax({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: 'https://api.minimaxi.com/anthropic/v1',
});

/**
 * 主对话模型（PRD §6.1 chat、§6.2 词典 LLM 兜底用）。
 *
 * 用 MiniMax-M2.1：thinking 模型，回答有深度但每次响应大头是推理 token。
 * 适合带语境的复杂解释（"这个词在本句里的特殊用法"）。
 *
 * 模型选择参考（截至 2026-05，需对应 plan 开通）：
 *   - MiniMax-M2.7   最新 thinking，最强但更慢
 *   - MiniMax-M2.5   thinking
 *   - MiniMax-M2.1   thinking，平衡（默认）
 *   - MiniMax-M2     thinking，老
 *
 * 注意 -highspeed 变体（如 M2.7-highspeed）只是关掉 CoT 的同一只大模型，
 * 不是真小快模型；当前开发 plan 也没解锁它们。短文本翻译走 Zhipu GLM-4-Flash
 * 而不是 MiniMax -highspeed，理由见 src/lib/zhipu.ts。
 */
export const DEFAULT_MODEL_ID = (process.env.MINIMAX_CHAT_MODEL ??
  'MiniMax-M2.1') as
  | 'MiniMax-M2'
  | 'MiniMax-M2.1'
  | 'MiniMax-M2.5'
  | 'MiniMax-M2.7'
  | string;
