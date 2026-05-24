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

export const DEFAULT_MODEL_ID = 'MiniMax-M2.1' as const;
