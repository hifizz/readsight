/**
 * Sidepanel App —— assistant-ui Thread 主舞台。
 *
 * 关键设计：
 *   1. 单列布局，header 右上角的 History 按钮把 ThreadList 折进 Popover。
 *      不做左右双栏 —— sidepanel 本来就窄，左边再留 200px 给历史列表会把
 *      对话挤死。
 *   2. SelectionContext 注入：用 `DefaultChatTransport.body` 的函数形式 +
 *      `useRef` 让每次 send 实时读最新选区，**不必重建 runtime**（重建会
 *      丢失对话状态）。
 *   3. 新选区来自 background 的 `SELECTION_READY` 消息时，自动 `switchToNewThread()`
 *      把现有对话归档、开一条新对话 —— 用户对同一个选区追问应该有独立 thread。
 *   4. 启动时再从 `chrome.storage.session` 兜底读一次"最近一次选区"，对付
 *      "sidepanel 还没挂载完，message 被 Chrome 丢弃"的情况（PRD §10）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { DefaultChatTransport } from 'ai';
import { History, X } from 'lucide-react';
import type { BackgroundMessage, SelectionContext } from '@/lib/messaging';
import { Thread } from '@/components/assistant-ui/thread';
import { ThreadList } from '@/components/assistant-ui/thread-list';
import { WordCard } from '@/components/word-card';
import { SpeakButton } from '@/components/speak-button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const STORAGE_KEY_LATEST = 'english-agent:latest-selection-id';
const STORAGE_KEY_PREFIX = 'english-agent:selection:';

export default function App() {
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  // 用 ref 让 transport body callback 拿到最新选区 —— 不能直接闭包捕获 selection，
  // 否则 runtime 创建时就把当时的 selection 烤死。
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

  // useMemo 确保 transport 只构造一次。BACKEND 是常量，selectionRef 是稳定引用。
  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: `${BACKEND}/api/chat`,
          // body 的函数形式：AI SDK v6 在每次发请求前调一次，相当于动态请求体扩展。
          // 这里取最新 selectionRef.current，让后端 route.ts 在 system prompt 注入语境。
          body: () => ({
            selectionContext: selectionRef.current ?? undefined,
          }),
        }),
      [],
    ),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* 这个桥接组件必须在 provider 内部，才能拿到 useAssistantRuntime。
          它负责监听 SELECTION_READY，触发 switchToNewThread，写 selection state。 */}
      <SelectionBridge onNewSelection={setSelection} />
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
          {/* WordCard 只对单词选区出现；其他类型靠 Thread 里的 LLM 解读就够了。 */}
          {selection?.selection.type === 'word' && (
            <WordCard surfaceForm={selection.selection.text} backendUrl={BACKEND} />
          )}

          <main className="flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

/**
 * 桥接 background 的消息 / session storage 与 assistant-ui runtime。
 *
 * 行为：
 *   - 收到新 SELECTION_READY: 调 `runtime.switchToNewThread()` 开新对话，再写 selection
 *     state；老对话仍在 ThreadList 里可回看
 *   - 启动时如果 session storage 有"最近一次选区"，只显示语境卡，不强行开新 thread
 *     （场景：用户刚关掉再打开 sidepanel，想继续看到上次的语境）
 */
function SelectionBridge({
  onNewSelection,
}: {
  onNewSelection: (ctx: SelectionContext) => void;
}) {
  const runtime = useAssistantRuntime();

  // 启动兜底：从 storage 取最近一次选区做 UI 恢复，不切 thread。
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

  // 实时通道：每次 SELECTION_READY 都开新 thread + 注入新语境。
  useEffect(() => {
    function onMessage(message: BackgroundMessage) {
      if (message.type === 'SELECTION_READY') {
        // 顺序很重要：先切到全新 thread，再 setState 让 ContextCard 跟着切换。
        // 反过来会让旧 thread 的最后一刻看到新语境卡，UI 闪一下。
        // switchToNewThread 是 Promise；不 await 也行（fire-and-forget），
        // assistant-ui 内部会触发 re-render 把 UI 切到空 thread。
        runtime.threads
          .switchToNewThread()
          .catch((err) => console.warn('[english-agent] switchToNewThread failed', err));
        onNewSelection(message.payload);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [runtime, onNewSelection]);

  return null;
}

/**
 * 语境卡：钉在 Thread 顶部展示当前关注的选区。
 * 关闭按钮 = 清掉语境，后续对话不再带 selectionContext，回归"通用问答"。
 */
function ContextCard({
  ctx,
  onClear,
}: {
  ctx: SelectionContext;
  onClear: () => void;
}) {
  // 单词类型不在 ContextCard 上挂 Speak —— WordCard 自己的 ▶ 按钮放词典真人音频，
  // 比 TTS 更准。其他类型（phrase / sentence / multi）才用 MiniMax T2A v2。
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
