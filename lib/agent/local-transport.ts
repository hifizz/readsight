/**
 * 侧边栏里的 ChatTransport。streamText 跑在扩展页面，不经过后端。
 *
 * ai@6.0.191 的 convertToModelMessages 是 async，并且要带上 tools，
 * 否则历史里的 tool part 转不回模型消息，多步循环的下一轮会丢结果。
 */
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { ActionTag, SelectionContext } from '@/lib/messaging';
import { getModels } from '@/lib/llm';
import { recordChatTurn } from '@/lib/records';
import { buildSystemPrompt, TOOL_HINT } from '@/lib/agent/prompts';
import { createTools, type ToolContext } from '@/lib/agent/tools';

export interface LocalChatBody {
  selectionContext?: SelectionContext;
  actionTag?: ActionTag;
  tabId?: number;
}

function extractUserText(message: UIMessage | undefined): string {
  if (!message || message.role !== 'user') return '';
  return (message.parts ?? [])
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export class LocalChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly getBody: () => LocalChatBody) {}

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const { selectionContext: ctx, actionTag, tabId } = this.getBody();
    const { chat, config } = await getModels();
    const toolCtx: ToolContext = { ctx, tabId };
    const tools = config.enableTools ? createTools(toolCtx) : undefined;
    const system = config.enableTools
      ? `${buildSystemPrompt(ctx, actionTag)}\n\n${TOOL_HINT}`
      : buildSystemPrompt(ctx, actionTag);
    const modelMessages = await convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
    });
    const result = streamText({
      model: chat,
      system,
      messages: modelMessages,
      abortSignal,
      ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
      onFinish: ({ text }) => {
        if (!ctx) return;
        const userText = extractUserText(messages.at(-1));
        void recordChatTurn({ ctx, userText, assistantText: text, actionTag });
      },
    });
    return result.toUIMessageStream({ sendReasoning: true });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
