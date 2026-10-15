/**
 * POST /api/chat —— 唯一的对话流式入口。
 *
 * 设计要点：
 *   1. Vercel AI SDK v6 `streamText` + `toUIMessageStreamResponse()`，与扩展端的
 *      assistant-ui `useChatRuntime` + `DefaultChatTransport` 端到端对齐。
 *   2. 请求体里可选的 `selectionContext` 写进 system prompt（PRD §6.1 结合语境）。
 *   3. PRD §7.2 轻路径：popup 按钮带 `actionTag` 来 + `format='text'` 拿纯文本流。
 *      重路径（sidepanel）默认 `format='ui'`，跟 assistant-ui 一一对齐。
 *   4. M2 落库：
 *      - 进入路由时 upsertSelectionContext（如有）—— 后端是唯一真相源
 *      - streamText.onFinish 把 user + assistant 两条 chat_messages 写库
 *        （threadId = selectionContext.id，M4 重放语境需要这条线）
 *      - 当 selection.type === 'word' 时调 lookupWord 拿 itemKey + recordEncounter；
 *        带 actionTag 走 'quick'，无 actionTag 走 'deepchat'
 *      - 所有落库 fire-and-forget，不阻塞 stream
 */
import crypto from 'node:crypto';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { deepseekV4ProChat, isDeepseekConfigured } from '@/lib/deepseek';
import { db } from '@/db/client';
import { chatMessages } from '@/db/schema';
import { upsertSelectionContext, type SelectionContextDTO } from '@/lib/selection-context';
import { recordEncounter } from '@/lib/encounter';
import { lookupWord } from '@/lib/lookup';
import { ACTION_TAG_PROMPTS, type ActionTag } from '@/lib/action-tags';
import { requireUser } from '@/lib/require-user';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type ChatRequestBody = {
  messages?: UIMessage[];
  selectionContext?: SelectionContextDTO;
  /** popup 快捷按钮 / sidepanel SuggestionBar 带的 tag —— 切系统提示；缺省 = 自由聊 */
  actionTag?: ActionTag;
};

function buildSystemPrompt(ctx: SelectionContextDTO | undefined, actionTag?: ActionTag): string {
  const base = buildBaseSystemPrompt(ctx);
  if (!actionTag) return base;
  const taskPrompt = ACTION_TAG_PROMPTS[actionTag];
  // 把 task 拼到 base 之后；base 给"角色 + 语境"，task 给"这次要做什么"
  return taskPrompt ? `${base}\n\n${taskPrompt}` : base;
}

function buildBaseSystemPrompt(ctx?: SelectionContextDTO): string {
  if (!ctx) {
    return '你是一位耐心的英语学习助手。回答简洁、贴合用户的英文阅读语境，必要时给地道译法和用法示例。';
  }
  const base = [
    `用户选中："${ctx.selection.text}"（类型：${ctx.selection.type}）。`,
    `所在句子："${ctx.context.sentence}"。`,
    `所在段落："${ctx.context.paragraph}"。`,
  ];
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
  return [
    '你是一位耐心的英语学习助手，正在帮助用户读懂一篇英文文章中的一段表达。',
    ...base,
    '请结合这个具体语境回答（地道译法 / 词义 / 用法 / 语法），不要脱离上下文给字典义。',
  ].join('\n');
}

/**
 * 从 assistant-ui 发来的 UIMessage 里抠出纯文本，用于落库。
 * UIMessage.parts 是 [{type:'text',text:'...'}, {type:'reasoning',...}] 数组。
 */
function extractUserText(m: UIMessage | undefined): string {
  if (!m || m.role !== 'user') return '';
  const parts = m.parts ?? [];
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export async function POST(req: Request) {
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const quota = await reserveUsage(authResult.user.id, 'chat_requests');
  if (!quota.allowed) return quotaExceededResponse(quota);
  if (!isDeepseekConfigured() || !deepseekV4ProChat) {
    return Response.json(
      {
        error: 'deepseek_not_configured',
        message: 'Chat is unavailable because DEEPSEEK_API_KEY is not configured.',
      },
      { status: 503 },
    );
  }

  const body = (await req.json()) as ChatRequestBody;
  const ctx = body.selectionContext;
  const actionTag = body.actionTag;

  // 1) 同步 upsert SelectionContext —— 后续 onFinish 写 chat_messages 时
  //    threadId(=ctx.id) 外键依赖它存在
  if (ctx) {
    try {
      await upsertSelectionContext(authResult.user.id, ctx);
    } catch (err) {
      const conflict = err instanceof Error && err.message === 'selection_context_conflict';
      return Response.json(
        { error: conflict ? 'selection_context_conflict' : 'selection_context_failed' },
        { status: conflict ? 409 : 500 },
      );
    }
  }

  const messages = body.messages ?? [];

  const result = streamText({
    model: deepseekV4ProChat,
    system: buildSystemPrompt(ctx, actionTag),
    messages: await convertToModelMessages(messages),
    /**
     * onFinish 拿到完整 assistant 文本后落库。fire-and-forget：内部不 await
     * 任何 DB 调用，靠 setImmediate 把它们扔到下一个 tick，避免阻塞 stream close。
     */
    onFinish: ({ text }) => {
      if (!ctx) return; // 没语境 = 不学习的闲聊，不留痕
      const latestUser = messages.at(-1);
      const userText = extractUserText(latestUser);
      const threadId = ctx.id;

      setImmediate(async () => {
        try {
          if (userText) {
            await db.insert(chatMessages).values({
              id: crypto.randomUUID(),
              userId: authResult.user.id,
              threadId,
              selectionContextId: ctx.id,
              role: 'user',
              content: { text: userText },
            });
          }
          await db.insert(chatMessages).values({
            id: crypto.randomUUID(),
            userId: authResult.user.id,
            threadId,
            selectionContextId: ctx.id,
            role: 'assistant',
            content: { text },
          });
        } catch (err) {
          console.warn('[chat] chat_messages insert failed', err);
        }

        // 单词类选区：去查词典拿 itemKey + 记 encounter；
        // 带 actionTag = popup 快捷动作走 'quick'，无 = sidepanel 深聊走 'deepchat'。
        // phrase/sentence/multi 没原子 itemKey，按 todo.m2 决策 #2 跳过事件落库。
        if (ctx.selection.type === 'word') {
          try {
            const lookup = await lookupWord(ctx.selection.text);
            void recordEncounter({
              userId: authResult.user.id,
              surfaceForm: ctx.selection.text,
              itemKey: lookup.itemKey,
              contextRef: ctx.id,
              eventType: actionTag ? 'quick' : 'deepchat',
            });
          } catch (err) {
            console.warn('[chat] encounter logging failed', err);
          }
        }
      });
    },
  });

  return result.toUIMessageStreamResponse();
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
