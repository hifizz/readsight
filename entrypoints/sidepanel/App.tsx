/**
 * Sidepanel App —— assistant-ui Thread 主舞台。
 *
 * 布局：
 *   标签栏（当前对话 | 学习记录 ──── ＋ 新会话）   固定
 *   ─────────────────────────────────
 *   语境卡 ContextCard                          固定（不滚动，非消息）
 *   ─────────────────────────────────
 *   ▼ Thread 滚动区
 *       WordCard（词典卡）                       随线程滚动 · 可折叠 · 非消息
 *       用户气泡 / 助手回复                       真消息
 *       SeedSuggestions（空态种子）               非消息
 *   ─────────────────────────────────
 *   Composer                                    固定
 *
 * 顶部不再放 "见微 Readsight" 标题栏 —— Chrome side panel 已有自己的 chrome，
 * demo 阶段画的那条只是示意。tab 栏右侧只放一个"新会话"图标按钮。
 *
 * 关键设计：
 *   1. ContextCard 钉在 Tabs 下方，全程可见。
 *   2. WordCard 注入 Thread 的 viewportPrefix —— 排在所有消息之前但身处
 *      scroll 区，聊开后会被顶上去滚走。
 *   3. SeedSuggestions 注入 Thread 的 welcome 槽，替换 "Hello there!"。
 *   4. SelectionContext 注入：DefaultChatTransport.body 函数形式 + useRef
 *      每次 send 实时读最新选区，不必重建 runtime（重建会丢对话状态）。
 *   5. 新选区来自 background 的 SELECTION_READY 时 switchToNewThread()，
 *      把现有对话归档，开一条新对话。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { DefaultChatTransport } from 'ai';
import { SquarePen } from 'lucide-react';
import type {
  ActionTag,
  AskWithSelectionPayload,
  BackgroundMessage,
  SelectionContext,
} from '@/lib/messaging';
import { userMessageForActionTag } from '@/lib/action-tags';
import { Thread } from '@/components/assistant-ui/thread';
import { WordCard } from '@/components/word-card';
import { ContextCard } from '@/components/context-card';
import { SeedSuggestions } from '@/components/seed-suggestions';
import { RecordsList, type HistoryRecord } from '@/components/records-list';
import { SettingsPanel } from '@/components/settings-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  authFetch,
  authHeaders,
  getAuthToken,
  getStoredAuthUser,
  refreshAuthUser,
  registerWithEmail,
  signInWithEmail,
  signOut,
  subscribeAuth,
  type AuthUser,
} from '@/lib/auth';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const STORAGE_KEY_LATEST = 'readsight:latest-selection-id';
const STORAGE_KEY_PREFIX = 'readsight:selection:';

type TabKey = 'chat' | 'records' | 'settings';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: AuthUser };

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ kind: 'loading' });

  const reloadAuth = useCallback(async () => {
    const [token, storedUser] = await Promise.all([getAuthToken(), getStoredAuthUser()]);
    if (!token) {
      setAuthState({ kind: 'signed-out' });
      return;
    }
    try {
      const user = await refreshAuthUser(BACKEND);
      setAuthState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' });
    } catch {
      setAuthState(storedUser ? { kind: 'signed-in', user: storedUser } : { kind: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void reloadAuth();
    return subscribeAuth(() => void reloadAuth());
  }, [reloadAuth]);

  if (authState.kind === 'loading') {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">正在检查登录状态…</div>;
  }
  if (authState.kind === 'signed-out') {
    return <AuthGate onAuthenticated={(user) => setAuthState({ kind: 'signed-in', user })} />;
  }
  return <AuthenticatedApp user={authState.user} onSignedOut={() => setAuthState({ kind: 'signed-out' })} />;
}

function AuthenticatedApp({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [recordsRefreshToken, setRecordsRefreshToken] = useState(0);

  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

  const pendingActionTagRef = useRef<ActionTag | null>(null);

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: `${BACKEND}/api/chat`,
          headers: () => authHeaders(),
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

  const handleSelectRecord = useCallback(async (record: HistoryRecord) => {
    if (!record.lastContextRef) return;
    try {
      const res = await authFetch(
        `${BACKEND}/api/selection-context/${encodeURIComponent(record.lastContextRef)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ctx = (await res.json()) as SelectionContext;
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
        <div className="flex h-screen flex-col bg-background text-foreground">
          {/* ── 标签栏（顶栏。新会话按钮 = 右侧唯一按钮，无文字、tooltip 兜文案） ── */}
          <div className="flex shrink-0 items-center border-b px-2.5 pt-1.5">
            <Tab active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
              当前对话
            </Tab>
            <Tab
              active={activeTab === 'records'}
              onClick={() => {
                setActiveTab('records');
                setRecordsRefreshToken((t) => t + 1);
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

          {/* ── 主体 ── */}
          {activeTab === 'chat' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* 语境卡：固定钉在 tab 下，不进滚动区 */}
              {selection && (
                <ContextCard
                  ctx={selection}
                  onClear={() => setSelection(null)}
                />
              )}

              {/* Thread：滚动区 + composer 一体 */}
              <div className="flex min-h-0 flex-1 flex-col">
                <Thread
                  viewportPrefix={
                    selection?.selection.type === 'word' ? (
                      <WordCard
                        surfaceForm={selection.selection.text}
                        backendUrl={BACKEND}
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
                backendUrl={BACKEND}
                onSelect={handleSelectRecord}
                refreshToken={recordsRefreshToken}
              />
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SettingsPanel />
              <div className="mx-4 mb-4 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">当前账号</p>
                <p className="mt-1 truncate text-sm font-medium">{user.email}</p>
                <button
                  type="button"
                  className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  onClick={() => {
                    void signOut(BACKEND).finally(onSignedOut);
                  }}
                >
                  退出登录
                </button>
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.includes('@')) {
      setError('请输入有效邮箱');
      return;
    }
    if (password.length < 10) {
      setError('密码至少需要 10 个字符');
      return;
    }
    setBusy(true);
    try {
      const user = mode === 'register'
        ? await registerWithEmail(BACKEND, email, password)
        : await signInWithEmail(BACKEND, email, password);
      await removePendingAutoSend();
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-background p-5 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-xl font-semibold">见微 Readsight</h1>
          <p className="mt-1 text-sm text-muted-foreground">登录后保存属于你的阅读与学习记录</p>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
          <button type="button" className={`rounded-md py-2 ${mode === 'sign-in' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`} onClick={() => { setMode('sign-in'); setError(null); }}>登录</button>
          <button type="button" className={`rounded-md py-2 ${mode === 'register' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`} onClick={() => { setMode('register'); setError(null); }}>创建账号</button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">邮箱</span>
            <input className="w-full rounded-md border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 transition-all transition-300" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">密码</span>
            <input className="w-full rounded-md border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 transition-all transition-300" type="password" minLength={10} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? '请稍候…' : mode === 'register' ? '创建账号' : '登录'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          当前不验证邮箱，也暂不支持忘记密码找回。请妥善保存密码。
        </p>
      </div>
    </main>
  );
}

async function removePendingAutoSend(): Promise<void> {
  const latest = await chrome.storage.session.get(STORAGE_KEY_LATEST);
  const id = latest[STORAGE_KEY_LATEST] as string | undefined;
  if (!id) return;
  const key = STORAGE_KEY_PREFIX + id;
  const stored = (await chrome.storage.session.get(key))[key] as AskWithSelectionPayload | SelectionContext | undefined;
  if (stored && 'ctx' in stored) await chrome.storage.session.set({ [key]: { ctx: stored.ctx } });
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
