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
 * 当前用 MiniMax-M2.1：thinking 模型，回答有深度但每次响应大头是推理 token。
 * 适合带语境的复杂解释（"这个词在本句里的特殊用法"）。
 *
 * 模型选择参考（截至 2026-05）：
 *   - MiniMax-M2.7   最新 thinking 模型，最强但更慢
 *   - MiniMax-M2.5   thinking
 *   - MiniMax-M2.1   thinking，平衡（我们的默认）
 *   - MiniMax-M2     thinking，老
 */
export const DEFAULT_MODEL_ID = (process.env.MINIMAX_CHAT_MODEL ??
  'MiniMax-M2.1') as
  | 'MiniMax-M2'
  | 'MiniMax-M2.1'
  | 'MiniMax-M2.5'
  | 'MiniMax-M2.7'
  | string;

/**
 * 翻译 / 短文本任务专用 —— 速度版（non-thinking）。
 *
 * MiniMax `-highspeed` 后缀模型不消耗 token 做 chain-of-thought，
 * 对"英→中字典短释义"这种机械任务又快又省。可用 ID（priority 高到低）：
 *   - MiniMax-M2.7-highspeed   最新
 *   - MiniMax-M2.5-highspeed
 *   - MiniMax-M2.1-highspeed
 *
 * 注意：MiniMax 平台不同 plan 对 -highspeed 的额度不同。当前开发 key
 * 的 "Token Plan Plus" 没分配 highspeed 额度（0/0 used），返 429。
 * 因此 lookup.ts 的 translateOnePos 写了自动降级到 DEFAULT_MODEL_ID
 * 的逻辑 —— 升级 plan 后零代码改动直接享受速度提升。
 */
export const TRANSLATE_MODEL_ID = (process.env.MINIMAX_TRANSLATE_MODEL ??
  'MiniMax-M2.7-highspeed') as string;
