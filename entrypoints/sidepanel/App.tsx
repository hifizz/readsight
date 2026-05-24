/**
 * Sidepanel App —— assistant-ui Thread 主舞台。
 *
 * 关键设计：
 *   1. 单列布局，header 右上角的 History 按钮把 ThreadList 折进 Popover。
 *   2. SelectionContext 注入：`DefaultChatTransport.body` 的函数形式 + `useRef`
 *      让每次 send 实时读最新选区，不必重建 runtime（重建会丢对话状态）。
 *   3. 新选区来自 background 的 `SELECTION_READY` 消息时自动 `switchToNewThread()`
 *      把现有对话归档、开一条新对话。
 *   4. 启动时再从 `chrome.storage.session` 兜底读最近一次选区（PRD §10）。
 *   5. 主区域 Tabs：Chat（assistant-ui Thread）/ Records（学习记录列表）。
 *      Records 点条目 → fetch SelectionContext 详情 → 切回 Chat tab + 重新挂语境卡。
 *      不重放历史对话内容（M4 任务），但 backend 会按 threadId=ctx.id
 *      继续往同一 thread 写消息，未来重放数据已就位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { DefaultChatTransport } from 'ai';
import { History, X, MessageSquare, BookOpen } from 'lucide-react';
import type { BackgroundMessage, SelectionContext } from '@/lib/messaging';
import { Thread } from '@/components/assistant-ui/thread';
import { ThreadList } from '@/components/assistant-ui/thread-list';
import { WordCard } from '@/components/word-card';
import { SpeakButton } from '@/components/speak-button';
import { RecordsList, type HistoryRecord } from '@/components/records-list';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const STORAGE_KEY_LATEST = 'english-agent:latest-selection-id';
const STORAGE_KEY_PREFIX = 'english-agent:selection:';

export default function App() {
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'records'>('chat');
  // 每次切到 records tab 就 +1 触发 RecordsList 重新拉历史 —— 用户期望看到最新
  const [recordsRefreshToken, setRecordsRefreshToken] = useState(0);

  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: `${BACKEND}/api/chat`,
          body: () => ({
            selectionContext: selectionRef.current ?? undefined,
          }),
        }),
      [],
    ),
  });

  // 点条目：load SelectionContext 详情 → 切回 chat + 触发原文 tab 高亮
  const handleSelectRecord = useCallback(
    async (record: HistoryRecord) => {
      if (!record.lastContextRef) return;
      try {
        const res = await fetch(
          `${BACKEND}/api/selection-context/${encodeURIComponent(record.lastContextRef)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ctx = (await res.json()) as SelectionContext;
        setActiveTab('chat');
        setSelection(ctx);

        // 让原文 tab 滚到对应位置 + 闪黄高亮（PRD §8.3 跳回原文）
        const highlightMsg: BackgroundMessage = {
          type: 'HIGHLIGHT_REQUEST',
          payload: { url: ctx.source.url, anchor: ctx.anchor },
        };
        chrome.runtime.sendMessage(highlightMsg).catch((err) => {
          // tab 已关或 background 没响应都常见，不打扰用户
          console.warn('[sidepanel] HIGHLIGHT_REQUEST failed', err);
        });
      } catch (err) {
        console.warn('[sidepanel] load selection-context failed', err);
      }
    },
    [],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SelectionBridge onNewSelection={setSelection} onArrival={() => setActiveTab('chat')} />
      <TooltipProvider>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <h1 className="text-sm font-semibold tracking-tight">English Agent</h1>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Open conversation history"
                >
                  <History className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <ScrollArea className="h-80">
                  <div className="p-2">
                    <ThreadList />
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </header>

          {selection && (
            <ContextCard ctx={selection} onClear={() => setSelection(null)} />
          )}
          {selection?.selection.type === 'word' && (
            <WordCard
              surfaceForm={selection.selection.text}
              backendUrl={BACKEND}
              selectionContext={selection}
            />
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              const next = v as 'chat' | 'records';
              setActiveTab(next);
              if (next === 'records') setRecordsRefreshToken((t) => t + 1);
            }}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-3 mt-1.5 grid h-8 grid-cols-2">
              <TabsTrigger value="chat" className="gap-1.5 text-xs">
                <MessageSquare className="size-3.5" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="records" className="gap-1.5 text-xs">
                <BookOpen className="size-3.5" />
                Records
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
              <Thread />
            </TabsContent>
            <TabsContent value="records" className="flex-1 overflow-y-auto mt-0">
              <RecordsList
                backendUrl={BACKEND}
                onSelect={handleSelectRecord}
                refreshToken={recordsRefreshToken}
              />
            </TabsContent>
          </Tabs>
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

function SelectionBridge({
  onNewSelection,
  onArrival,
}: {
  onNewSelection: (ctx: SelectionContext) => void;
  /** 新选区到来时也切回 chat tab，避免用户在 records 视图里错过新对话 */
  onArrival: () => void;
}) {
  const runtime = useAssistantRuntime();

  useEffect(() => {
    let cancelled = false;
    chrome.storage.session.get(STORAGE_KEY_LATEST).then(async (res) => {
      const id = res[STORAGE_KEY_LATEST] as string | undefined;
      if (!id || cancelled) return;
      const r2 = await chrome.storage.session.get(STORAGE_KEY_PREFIX + id);
      const ctx = r2[STORAGE_KEY_PREFIX + id] as SelectionContext | undefined;
      if (ctx && !cancelled) onNewSelection(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [onNewSelection]);

  useEffect(() => {
    function onMessage(message: BackgroundMessage) {
      if (message.type === 'SELECTION_READY') {
        runtime.threads
          .switchToNewThread()
          .catch((err) => console.warn('[english-agent] switchToNewThread failed', err));
        onArrival();
        onNewSelection(message.payload);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [runtime, onNewSelection, onArrival]);

  return null;
}

function ContextCard({
  ctx,
  onClear,
}: {
  ctx: SelectionContext;
  onClear: () => void;
}) {
  const showSpeak = ctx.selection.type !== 'word';
  return (
    <div className="border-b bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {ctx.selection.type}
            </span>
            <span className="truncate text-muted-foreground">
              {ctx.source.heading || ctx.source.title}
            </span>
          </div>
          <div className="line-clamp-2 font-medium">"{ctx.selection.text}"</div>
          <div className="mt-1 line-clamp-2 text-muted-foreground">
            {ctx.context.sentence}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {showSpeak && (
            <SpeakButton text={ctx.selection.text} backendUrl={BACKEND} />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onClear}
            aria-label="Clear selection context"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
