/**
 * Sidepanel App —— assistant-ui Thread 主舞台。
 *
 * 对话走 LocalChatTransport：streamText 在这个扩展页面里跑，不经过后端。
 * body 用 ref 在每次发送时读最新选区，避免重建 runtime 丢掉对话。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { SquarePen } from 'lucide-react';
import type {
  ActionTag,
  AskWithSelectionPayload,
  BackgroundMessage,
  SelectionContext,
} from '@/lib/messaging';
import { userMessageForActionTag } from '@/lib/action-tags';
import { LocalChatTransport } from '@/lib/agent/local-transport';
import { PENDING_TAB_KEY } from '@/lib/llm-config';
import { useLLMConfig } from '@/lib/use-llm-config';
import { getSelectionContext } from '@/lib/records';
import { Thread } from '@/components/assistant-ui/thread';
import { WordCard } from '@/components/word-card';
import { ContextCard } from '@/components/context-card';
import { SeedSuggestions } from '@/components/seed-suggestions';
import { RecordsList, type HistoryRecord } from '@/components/records-list';
import { SettingsPanel } from '@/components/settings-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STORAGE_KEY_LATEST = 'readsight:latest-selection-id';
const STORAGE_KEY_PREFIX = 'readsight:selection:';

type TabKey = 'chat' | 'records' | 'settings';

export default function App() {
  const { config } = useLLMConfig();
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [recordsRefreshToken, setRecordsRefreshToken] = useState(0);

  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;
  const pendingActionTagRef = useRef<ActionTag | null>(null);
  const activeTabIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      activeTabIdRef.current = tabs[0]?.id;
    }).catch(() => {});
    const onActivated = (info: { tabId: number }) => {
      activeTabIdRef.current = info.tabId;
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, []);

  useEffect(() => {
    const onMessage = (message: BackgroundMessage) => {
      if (message.type === 'OPEN_SETTINGS') setActiveTab('settings');
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.session.get(PENDING_TAB_KEY).then((stored) => {
      if (stored[PENDING_TAB_KEY] === 'settings') {
        setActiveTab('settings');
        void chrome.storage.session.remove(PENDING_TAB_KEY);
      }
    }).catch(() => {});
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new LocalChatTransport(() => {
          const actionTag = pendingActionTagRef.current ?? undefined;
          pendingActionTagRef.current = null;
          return {
            selectionContext: selectionRef.current ?? undefined,
            actionTag,
            tabId: activeTabIdRef.current,
          };
        }),
      [],
    ),
  });

  const handleSelectRecord = useCallback(async (record: HistoryRecord) => {
    if (!record.lastContextRef) return;
    try {
      const ctx = await getSelectionContext(record.lastContextRef);
      if (!ctx) return;
      setActiveTab('chat');
      setSelection(ctx);
      const highlightMsg: BackgroundMessage = {
        type: 'HIGHLIGHT_REQUEST',
        payload: { url: ctx.source.url, anchor: ctx.anchor },
      };
      chrome.runtime.sendMessage(highlightMsg).catch((err) => {
        console.warn('[sidepanel] HIGHLIGHT_REQUEST failed', err);
      });
    } catch (err) {
      console.warn('[sidepanel] load selection-context failed', err);
    }
  }, []);

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
        <div data-testid="sidepanel-app" className="flex h-screen flex-col bg-background text-foreground">
          <div className="flex shrink-0 items-center border-b px-2.5 pt-1.5">
            <Tab active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
              当前对话
            </Tab>
            <Tab
              active={activeTab === 'records'}
              onClick={() => {
                setActiveTab('records');
                setRecordsRefreshToken((token) => token + 1);
              }}
            >
              学习记录
            </Tab>
            <Tab
              active={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
            >
              设置
            </Tab>
            <div className="flex-1" />
            <NewThreadButton
              onClick={async () => {
                setSelection(null);
                setActiveTab('chat');
                try {
                  await runtime.threads.switchToNewThread();
                } catch (err) {
                  console.warn('[sidepanel] switchToNewThread failed', err);
                }
              }}
            />
          </div>

          {activeTab === 'chat' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {!config.apiKey && (
                <div data-testid="no-key-banner" className="shrink-0 border-b bg-muted/50 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
                  还没有配置模型 API Key。英文词典仍可用；对话、翻译和中文释义需要 Key。
                  <button
                    type="button"
                    className="ml-2 font-medium text-foreground underline"
                    onClick={() => setActiveTab('settings')}
                  >
                    去设置
                  </button>
                </div>
              )}
              {selection && (
                <ContextCard
                  ctx={selection}
                  onClear={() => setSelection(null)}
                />
              )}
              <div className="flex min-h-0 flex-1 flex-col">
                <Thread
                  viewportPrefix={
                    selection?.selection.type === 'word' ? (
                      <WordCard
                        surfaceForm={selection.selection.text}
                        selectionContext={selection}
                      />
                    ) : null
                  }
                  welcome={
                    selection ? <SeedSuggestions selection={selection} /> : null
                  }
                />
              </div>
            </div>
          )}
          {activeTab === 'records' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RecordsList
                onSelect={handleSelectRecord}
                refreshToken={recordsRefreshToken}
              />
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SettingsPanel />
            </div>
          )}
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

function NewThreadButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="新会话"
          onClick={onClick}
          className="-mb-px mr-0.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SquarePen className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        新会话
      </TooltipContent>
    </Tooltip>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[13px] transition-colors ${
        active
          ? 'border-foreground font-semibold text-foreground'
          : 'border-transparent font-normal text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function SelectionBridge({
  onNewSelection,
  onArrival,
  selectionRef,
  pendingActionTagRef,
}: {
  onNewSelection: (ctx: SelectionContext) => void;
  onArrival: () => void;
  selectionRef: React.MutableRefObject<SelectionContext | null>;
  pendingActionTagRef: React.MutableRefObject<ActionTag | null>;
}) {
  const runtime = useAssistantRuntime();
  const autoSentIdsRef = useRef(new Set<string>());
  const processedCtxIdsRef = useRef(new Set<string>());

  const dispatch = useCallback(
    async (payload: AskWithSelectionPayload) => {
      const { ctx, actionTag, initialMessage } = payload;
      const isNewCtx = !processedCtxIdsRef.current.has(ctx.id);
      const wantsAutoSend = !!(actionTag || initialMessage);
      const alreadySent = wantsAutoSend && autoSentIdsRef.current.has(ctx.id);

      onArrival();
      selectionRef.current = ctx;
      onNewSelection(ctx);

      if (isNewCtx) {
        processedCtxIdsRef.current.add(ctx.id);
        try {
          await runtime.threads.switchToNewThread();
        } catch (err) {
          console.warn('[readsight] switchToNewThread failed', err);
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
      const payload: AskWithSelectionPayload =
        'ctx' in stored ? stored : { ctx: stored };
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
          console.warn('[readsight] dispatch failed', err),
        );
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [dispatch]);

  return null;
}
