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
import type {
  ActionTag,
  AskWithSelectionPayload,
  BackgroundMessage,
  SelectionContext,
} from '@/lib/messaging';
import {
  actionsForSelectionType,
  userMessageForActionTag,
} from '@/lib/action-tags';
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

  /**
   * popup 快捷按钮 / sidepanel SuggestionBar 设的"本次请求带 actionTag"。
   * transport.body() 用完即清；下一次普通输入回到无 tag 自由聊。
   */
  const pendingActionTagRef = useRef<ActionTag | null>(null);

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: `${BACKEND}/api/chat`,
          body: () => {
            const actionTag = pendingActionTagRef.current ?? undefined;
            pendingActionTagRef.current = null;
            return {
              selectionContext: selectionRef.current ?? undefined,
              actionTag,
            };
          },
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

  /**
   * 代用户发：跟用户在输入框打字 + 按 Send 完全等价 —— `composer.setText` +
   * `composer.send()`。
   *
   * 为什么不用 `runtime.thread.append`：append 会触发 thread 切换/创建的隐式
   * 路径，跟 `switchToNewThread` 撞在一起时，消息发到的 thread 跟 UI 渲染的
   * thread 不是同一个，结果就是"后端有请求 / 前端 thread 空着"。直接驱动当前
   * 可见的 composer，永远跟用户眼前的 thread 一致。
   */
  const sendActionTag = useCallback(
    (tag: ActionTag) => {
      pendingActionTagRef.current = tag;
      runtime.thread.composer.setText(userMessageForActionTag(tag));
      runtime.thread.composer.send();
    },
    [runtime],
  );

  // 关键：稳定回调 ref，避免 SelectionBridge 内 useCallback(dispatch) 因为
  // onArrival 是新 arrow 而每 render 重建 —— 那会让 dispatch 依赖的 useEffect
  // 反复 cleanup+rerun，进而反复 setSelection / 反复发 /api/lookup（死循环源）。
  const onArrival = useCallback(() => setActiveTab('chat'), []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SelectionBridge
        onNewSelection={setSelection}
        onArrival={onArrival}
        selectionRef={selectionRef}
        pendingActionTagRef={pendingActionTagRef}
      />
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
              <Thread
                composerPrefix={
                  selection ? (
                    <SuggestionBar selection={selection} onPick={sendActionTag} />
                  ) : null
                }
              />
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
  selectionRef,
  pendingActionTagRef,
}: {
  onNewSelection: (ctx: SelectionContext) => void;
  /** 新选区到来时也切回 chat tab，避免用户在 records 视图里错过新对话 */
  onArrival: () => void;
  /** 透传父级 ref：手动同步 selectionRef.current，确保 thread.append 的 body() 拿到新 ctx */
  selectionRef: React.MutableRefObject<SelectionContext | null>;
  /** 透传父级 ref：自动发送时把 actionTag 塞进去给 transport.body() 用 */
  pendingActionTagRef: React.MutableRefObject<ActionTag | null>;
}) {
  const runtime = useAssistantRuntime();
  /** 已经"代用户发过"的 ctx.id，避免 storage-path 和 onMessage-path 双触发自动发送 */
  const autoSentIdsRef = useRef(new Set<string>());
  /**
   * 已经"开过新 thread"的 ctx.id —— 跟 autoSentIdsRef 分开，因为深聊+空输入框
   * 这条路 wantsAutoSend=false 但仍然要给该选区开新 thread。
   */
  const processedCtxIdsRef = useRef(new Set<string>());

  /**
   * SELECTION_READY 事件处理：每个新选区开新 thread，按需代用户发一条消息。
   *
   * 关键：先 await switchToNewThread()，再调 composer.setText + composer.send。
   * 为什么不是 runtime.thread.append —— append 抓的是 stale binding，
   * useChat({id}) 还没 re-key 时落到旧 thread，UI 显示新 thread 空着。
   * composer.send 在调用时刻读 core state，所以 await 完 switch 之后就指向新 thread。
   */
  const dispatch = useCallback(
    async (payload: AskWithSelectionPayload) => {
      const { ctx, actionTag, initialMessage } = payload;
      const isNewCtx = !processedCtxIdsRef.current.has(ctx.id);
      const wantsAutoSend = !!(actionTag || initialMessage);
      const alreadySent = wantsAutoSend && autoSentIdsRef.current.has(ctx.id);

      // 选区状态先刷新；同一个 ctx.id 二次进入（race）也走这一步保证 UI 状态新
      onArrival();
      // 手动同步 ref：紧随其后的 transport.body() 立刻就能在 selectionRef.current
      // 拿到新 ctx（React state 异步，本帧 selectionRef.current = selection 还没生效）
      selectionRef.current = ctx;
      onNewSelection(ctx);

      // 新 ctx → 开新 thread；二次进入直接复用当前 thread
      if (isNewCtx) {
        processedCtxIdsRef.current.add(ctx.id);
        try {
          await runtime.threads.switchToNewThread();
        } catch (err) {
          console.warn('[english-agent] switchToNewThread failed', err);
        }
      }

      if (!wantsAutoSend || alreadySent) return;
      autoSentIdsRef.current.add(ctx.id);

      if (actionTag) {
        pendingActionTagRef.current = actionTag;
        runtime.thread.composer.setText(userMessageForActionTag(actionTag));
      } else if (initialMessage) {
        runtime.thread.composer.setText(initialMessage);
      }
      runtime.thread.composer.send();
    },
    [runtime, onArrival, onNewSelection, selectionRef, pendingActionTagRef],
  );

  // 启动兜底：sidepanel 第一次挂载晚于 ASK 时 SELECTION_READY 已经没接住，
  // 从 session storage 里读一份。dispatch 内的 autoSentIdsRef 保证同一个
  // ctx.id 即使 onMessage 那条路也来了也不会重复 send。
  useEffect(() => {
    let cancelled = false;
    chrome.storage.session.get(STORAGE_KEY_LATEST).then(async (res) => {
      const id = res[STORAGE_KEY_LATEST] as string | undefined;
      if (!id || cancelled) return;
      const r2 = await chrome.storage.session.get(STORAGE_KEY_PREFIX + id);
      const stored = r2[STORAGE_KEY_PREFIX + id] as
        | AskWithSelectionPayload
        | SelectionContext
        | undefined;
      if (!stored || cancelled) return;
      // 兼容旧 storage（直接存 SelectionContext）vs 新 storage（存 payload）
      const payload: AskWithSelectionPayload =
        'ctx' in stored ? stored : { ctx: stored };
      // 清掉 storage 里的 actionTag/initialMessage —— 否则刷新 sidepanel 又会自动发
      if (payload.actionTag || payload.initialMessage) {
        chrome.storage.session
          .set({ [STORAGE_KEY_PREFIX + id]: { ctx: payload.ctx } })
          .catch(() => {});
      }
      await dispatch(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    function onMessage(message: BackgroundMessage) {
      if (message.type === 'SELECTION_READY') {
        dispatch(message.payload).catch((err) =>
          console.warn('[english-agent] dispatch failed', err),
        );
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [dispatch]);

  return null;
}

/**
 * 输入框上方的快捷按钮条 —— 镜像 popup 4 按钮，按 selection.type 切。
 * 点一下 = 代用户发"词义/翻句/..."；server 端 actionTag 切系统提示。
 */
function SuggestionBar({
  selection,
  onPick,
}: {
  selection: SelectionContext;
  onPick: (tag: ActionTag) => void;
}) {
  // 跳过 pronunciation —— sidepanel 已经有 ContextCard / WordCard 的喇叭按钮
  // 提供 Tier 0/1 发音，重复了反而干扰
  const actions = actionsForSelectionType(selection.selection.type).filter(
    (a) => a.tag !== 'pronunciation',
  );
  return (
    <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-wrap gap-1.5 px-1">
      {actions.map((a) => (
        <button
          key={a.tag}
          type="button"
          onClick={() => onPick(a.tag)}
          className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
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
