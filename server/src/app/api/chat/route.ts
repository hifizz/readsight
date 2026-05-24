/**
 * POST /api/chat —— 唯一的对话流式入口。
 *
 * 设计要点：
 *   1. 走 Vercel AI SDK v6 的 streamText + `toUIMessageStreamResponse()`，
 *      与扩展端的 assistant-ui `useChatRuntime` + `DefaultChatTransport`
 *      端到端协议对齐。
 *   2. 从请求体里读可选的 `selectionContext`（扩展端 transport.body() 注入），
 *      把"用户选中的词/句/段、所在句、所在段"写进 system prompt
 *      —— PRD §6.1 "结合本句的地道译法"必须靠这步实现。
 *   3. 显式 export `OPTIONS` 返回 204 让浏览器扩展的 CORS 预检直接通过；
 *      CORS 响应头由 `next.config.ts` 全局注入。
 *
 * 还没做（按 todo 计划）：
 *   - 落库 EncounterEvent（PRD §5.2 / §7.3）—— schema 已建，待写 onFinish 回调
 *   - 单词模式：把 selection.type === 'word' 时去查词典 API（PRD §6.2）
 */
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { minimax, DEFAULT_MODEL_ID } from '@/lib/minimax';

// Vercel 边缘函数的最大执行时间。流式响应可能拖到几十秒，所以拉到 30s。
export const maxDuration = 30;
// 不要被 Next 的 ISR/SSG 命中：每次都即时执行。
export const dynamic = 'force-dynamic';

type SelectionContextPayload = {
  selection: { text: string; type: string };
  context: { sentence: string; paragraph: string };
  source?: { title?: string; url?: string };
};

type ChatRequestBody = {
  messages: UIMessage[];
  selectionContext?: SelectionContextPayload;
};

function buildSystemPrompt(ctx?: SelectionContextPayload): string {
  if (!ctx) {
    return '你是一位耐心的英语学习助手。回答简洁、贴合用户的英文阅读语境，必要时给地道译法和用法示例。';
  }
  const base = [
    `用户选中："${ctx.selection.text}"（类型：${ctx.selection.type}）。`,
    `所在句子："${ctx.context.sentence}"。`,
    `所在段落："${ctx.context.paragraph}"。`,
  ];

  // 按选区类型分支：
  //   - word: 用户旁边已经能看到词典卡片（IPA / 词性 / 本意定义），LLM 专注讲
  //     "这个词在本句里的特殊用法 vs 普通用法"，不要重复字典义浪费用户时间。
  //   - 其他: 句子 / 短语 / 多句，走原本的"结合语境地道译法 + 语法"路径。
  if (ctx.selection.type === 'word') {
    return [
      '你是一位耐心的英语学习助手。用户正在阅读一篇英文文章，刚选中了一个词。',
      ...base,
      '重要：词典基本义（IPA / 词性 / 字典定义）用户已经在旁边看到了，不要重复。请专注解释：',
      '  1. 这个词在这一句里具体是什么意思、为什么作者要这样用',
      '  2. 跟它平常的、最常见的用法相比有什么差别（语气 / 感情色彩 / 搭配 / 隐含意）',
      '  3. 如果存在更地道的中文译法、或者英文里常见的搭配，给一两个例子',
      '回答简洁，控制在 3-5 句。',
    ].join('\n');
  }

  // 句子 / 短语 / 多句路径（PRD §6.1 结合语境的地道译法）
  return [
    '你是一位耐心的英语学习助手，正在帮助用户读懂一篇英文文章中的一段表达。',
    ...base,
    '请结合这个具体语境回答（地道译法 / 词义 / 用法 / 语法），不要脱离上下文给字典义。',
  ].join('\n');
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequestBody;

  const result = streamText({
    model: minimax(DEFAULT_MODEL_ID),
    system: buildSystemPrompt(body.selectionContext),
    // convertToModelMessages 在 AI SDK v6 改为 async（把附件/工具调用解析丢进 Promise）。
    messages: await convertToModelMessages(body.messages ?? []),
  });

  // 用 UIMessage stream 协议把 AI SDK 内部事件流转成 assistant-ui 可消费的 SSE。
  return result.toUIMessageStreamResponse();
}

// 浏览器扩展从 chrome-extension:// origin 直连本地 dev server 会先发预检 OPTIONS。
// Next 16 默认对未声明的方法返回 404，所以显式响应 204；
// CORS 头由 next.config.ts 统一注入。
export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
