import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  BookmarkPlus,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderCog,
  FolderPlus,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
  UserRound
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  authFetch,
  getAuthToken,
  getStoredAuthUser,
  refreshAuthUser,
  registerWithEmail,
  signInWithEmail,
  signOut,
  subscribeAuth,
  type AuthUser
} from '@/lib/auth';
import {
  BACKEND,
  captureItemFromTab,
  submitCaptures,
  type CaptureResult
} from '@/lib/capture';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: AuthUser };
type Project = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
};
type Source = {
  id: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  faviconUrl: string | null;
  lastCapturedAt: string;
  projectIds: string[];
};
type Analysis = {
  id: string;
  version: number;
  summary: string;
  keyPoints: string[];
  topics: string[];
  entities: Array<{ name: string; type?: string }>;
  contentType: string | null;
  createdAt: string;
};
type AnalysisRun = {
  id: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
};
type ProjectInsight = {
  id: string;
  version: number;
  whyItMatters: string;
  implications: string[];
};
type Thread = { id: string; title: string | null };
type ThreadMessage = {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  sourceAnalysisId: string | null;
  projectInsightId: string | null;
};
type InboxRange = 'today' | '7d' | '30d' | 'all';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ kind: 'loading' });
  const reloadAuth = useCallback(async () => {
    const [token, storedUser] = await Promise.all([
      getAuthToken(),
      getStoredAuthUser()
    ]);
    if (!token) return setAuthState({ kind: 'signed-out' });
    try {
      const user = await refreshAuthUser(BACKEND);
      setAuthState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' });
    } catch {
      setAuthState(
        storedUser
          ? { kind: 'signed-in', user: storedUser }
          : { kind: 'signed-out' }
      );
    }
  }, []);
  useEffect(() => {
    void reloadAuth();
    return subscribeAuth(() => void reloadAuth());
  }, [reloadAuth]);
  return (
    <TooltipProvider>
      {authState.kind === 'loading' && <LoadingView />}
      {authState.kind === 'signed-out' && (
        <AuthGate
          onAuthenticated={(user) => setAuthState({ kind: 'signed-in', user })}
        />
      )}
      {authState.kind === 'signed-in' && (
        <RelataHome
          user={authState.user}
          onSignedOut={() => setAuthState({ kind: 'signed-out' })}
        />
      )}
    </TooltipProvider>
  );
}

function LoadingView() {
  return (
    <main className="p-3">
      <div className="flex h-9 items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-7 rounded-full" />
      </div>
      <Separator />
      <div className="space-y-2 pt-4">
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-12 w-full" />
        ))}
      </div>
    </main>
  );
}

function RelataHome({
  user,
  onSignedOut
}: {
  user: AuthUser;
  onSignedOut: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [inboxSources, setInboxSources] = useState<Source[]>([]);
  const [inboxRange, setInboxRange] = useState<InboxRange>('today');
  const [inboxLoading, setInboxLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [analyzingSource, setAnalyzingSource] = useState<Source | null>(null);
  const [results, setResults] = useState<CaptureResult[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const refreshBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResponse, sourceResponse] = await Promise.all([
        authFetch(`${BACKEND}/api/projects`),
        authFetch(`${BACKEND}/api/sources`)
      ]);
      if (!projectResponse.ok || !sourceResponse.ok)
        throw new Error('无法加载保存内容。');
      const [projectBody, sourceBody] = await Promise.all([
        projectResponse.json() as Promise<{ projects: Project[] }>,
        sourceResponse.json() as Promise<{ sources: Source[] }>
      ]);
      setProjects(projectBody.projects);
      setSources(sourceBody.sources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载保存内容。');
    } finally {
      setLoading(false);
    }
  }, []);
  const refreshInbox = useCallback(async () => {
    setInboxLoading(true);
    setError(null);
    try {
      const response = await authFetch(
        `${BACKEND}/api/sources?${inboxRangeQuery(inboxRange)}`
      );
      if (!response.ok) throw new Error('无法加载 Inbox。');
      setInboxSources(
        ((await response.json()) as { sources: Source[] }).sources
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载 Inbox。');
    } finally {
      setInboxLoading(false);
    }
  }, [inboxRange]);
  const refreshAll = useCallback(
    () => Promise.all([refreshBase(), refreshInbox()]),
    [refreshBase, refreshInbox]
  );
  useEffect(() => {
    void refreshBase();
  }, [refreshBase]);
  useEffect(() => {
    void refreshInbox();
  }, [refreshInbox]);
  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isCaptureResultMessage(message)) return;
      setResults(message.payload);
      void refreshAll();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshAll]);
  const sourcesByProject = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.id,
          sources.filter((source) => source.projectIds.includes(project.id))
        ])
      ),
    [projects, sources]
  );
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(BACKEND);
    } finally {
      onSignedOut();
      setSigningOut(false);
    }
  };
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-11 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur">
        <h1 className="mr-auto pl-1 text-sm font-semibold">阅读列表</h1>
        <HeaderAction label="保存当前链接" onClick={() => setCaptureOpen(true)}>
          <BookmarkPlus />
        </HeaderAction>
        <HeaderAction label="创建 Project" onClick={() => setProjectOpen(true)}>
          <FolderPlus />
        </HeaderAction>
        <UserMenu
          user={user}
          signingOut={signingOut}
          onSignOut={() => void handleSignOut()}
        />
      </header>
      <div className="px-2 py-2">
        {results.length > 0 && (
          <CaptureResults results={results} onDismiss={() => setResults([])} />
        )}
        {error && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <SourceListSkeleton />
        ) : (
          <div className="space-y-4">
            <InboxGroup
              range={inboxRange}
              onRangeChange={setInboxRange}
              loading={inboxLoading}
              sources={inboxSources}
              onAnalyze={setAnalyzingSource}
              onEditMembership={setEditingSource}
            />
            <ProjectList
              projects={projects}
              sourcesByProject={sourcesByProject}
              onAnalyze={setAnalyzingSource}
              onEditMembership={setEditingSource}
            />
          </div>
        )}
      </div>
      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
          <DialogHeader className="gap-1">
            <DialogTitle>保存当前链接</DialogTitle>
            <DialogDescription>
              Intent 和 Project 都是可选的。
            </DialogDescription>
          </DialogHeader>
          <CaptureForm
            projects={projects}
            onResult={(next) => {
              setResults(next);
              if (next.some((item) => item.ok)) setCaptureOpen(false);
              void refreshAll();
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
          <DialogHeader className="gap-1">
            <DialogTitle>创建 Project</DialogTitle>
            <DialogDescription>
              用于组织围绕同一目标保存的 Sources。
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            onCreated={() => {
              setProjectOpen(false);
              void refreshBase();
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={editingSource !== null}
        onOpenChange={(open) => {
          if (!open) setEditingSource(null);
        }}
      >
        {editingSource && (
          <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3">
            <DialogHeader className="gap-1">
              <DialogTitle>关联 Project</DialogTitle>
              <DialogDescription className="line-clamp-2">
                {editingSource.title}
              </DialogDescription>
            </DialogHeader>
            <MembershipForm
              source={editingSource}
              projects={projects}
              onSaved={() => {
                setEditingSource(null);
                void refreshAll();
              }}
            />
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={analyzingSource !== null}
        onOpenChange={(open) => {
          if (!open) setAnalyzingSource(null);
        }}
      >
        {analyzingSource && (
          <AnalysisPanel source={analyzingSource} projects={projects} />
        )}
      </Dialog>
    </main>
  );
}

function HeaderAction({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu({
  user,
  signingOut,
  onSignOut
}: {
  user: AuthUser;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="用户菜单"
        >
          <Avatar size="sm">
            <AvatarImage src={(user as AuthUser & { image?: string }).image} />
            <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-foreground">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={onSignOut}
        >
          <LogOut />
          {signingOut ? '退出中…' : '退出登录'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InboxGroup({
  range,
  onRangeChange,
  loading,
  sources,
  onAnalyze,
  onEditMembership
}: {
  range: InboxRange;
  onRangeChange: (range: InboxRange) => void;
  loading: boolean;
  sources: Source[];
  onAnalyze: (source: Source) => void;
  onEditMembership: (source: Source) => void;
}) {
  return (
    <section>
      <div className="flex h-7 items-center px-1">
        <h2 className="text-xs font-medium">Inbox</h2>
        <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
          {sources.length}
        </span>
        <Select
          value={range}
          onValueChange={(value) => onRangeChange(value as InboxRange)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Inbox 时间范围"
            className="ml-auto h-6 w-auto gap-0.5 border-transparent bg-transparent px-1.5 text-[10px] text-muted-foreground shadow-none hover:bg-muted focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="min-w-24">
            <SelectItem value="today">今天</SelectItem>
            <SelectItem value="7d">近 7 天</SelectItem>
            <SelectItem value="30d">近 30 天</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <div className="space-y-1 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sources.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          这个时间范围内没有未归类链接。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onAnalyze={onAnalyze}
              onEditMembership={onEditMembership}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectList({
  projects,
  sourcesByProject,
  onAnalyze,
  onEditMembership
}: {
  projects: Project[];
  sourcesByProject: Map<string, Source[]>;
  onAnalyze: (source: Source) => void;
  onEditMembership: (source: Source) => void;
}) {
  return (
    <section>
      <div className="flex h-7 items-center px-1">
        <h2 className="text-xs font-medium">Projects</h2>
        <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
          {projects.length}
        </span>
      </div>
      {projects.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          创建 Project 后会显示在这里。
        </p>
      ) : (
        <div className="divide-y divide-border">
          {projects.map((project) => (
            <ProjectListItem
              key={project.id}
              project={project}
              sources={sourcesByProject.get(project.id) ?? []}
              onAnalyze={onAnalyze}
              onEditMembership={onEditMembership}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectListItem({
  project,
  sources,
  onAnalyze,
  onEditMembership
}: {
  project: Project;
  sources: Source[];
  onAnalyze: (source: Source) => void;
  onEditMembership: (source: Source) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 w-full justify-start gap-2 rounded-none px-1.5 text-xs font-normal"
          title={project.name}
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Folder className="size-4 shrink-0 text-primary" />
          <span className="max-w-[180px] min-w-0 flex-1 truncate text-left font-medium">
            {project.name}
          </span>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {sources.length}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 border-l pl-1.5">
          {sources.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              暂无链接。
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onAnalyze={onAnalyze}
                  onEditMembership={onEditMembership}
                />
              ))}
            </ul>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceRow({
  source,
  onAnalyze,
  onEditMembership
}: {
  source: Source;
  onAnalyze: (source: Source) => void;
  onEditMembership: (source: Source) => void;
}) {
  return (
    <li className="group flex min-h-12 items-center gap-2 px-1 py-1.5 hover:bg-muted/50">
      {source.faviconUrl ? (
        <img
          className="size-7 rounded-md bg-muted object-contain"
          src={source.faviconUrl}
          alt=""
        />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
          R
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a
          className="block truncate text-xs font-medium hover:underline"
          href={source.originalUrl}
          target="_blank"
          rel="noreferrer"
          title={source.title}
        >
          {source.title}
        </a>
        <p className="truncate text-[10px] text-muted-foreground">
          {domainFor(source.originalUrl)} ·{' '}
          {relativeTime(source.lastCapturedAt)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            className="opacity-60 group-hover:opacity-100"
            aria-label={`${source.title} 的更多操作`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => onAnalyze(source)}>
            <Sparkles />
            分析与讨论
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEditMembership(source)}>
            <FolderCog />
            关联 Project
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={source.originalUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              打开链接
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function CaptureForm({
  projects,
  onResult
}: {
  projects: Project[];
  onResult: (results: CaptureResult[]) => void;
}) {
  const [intent, setIntent] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      const item = tab ? captureItemFromTab(tab, 'side_panel') : null;
      if (!item) throw new Error('当前标签页无法保存。');
      onResult(
        await submitCaptures([
          { ...item, intent: intent.trim() || undefined, projectIds }
        ])
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '当前标签页无法保存。'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5">
        <Label htmlFor="capture-intent">
          Intent <span className="font-normal text-muted-foreground">可选</span>
        </Label>
        <Textarea
          id="capture-intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="为什么保存它？"
          className="min-h-16 text-xs"
          maxLength={4_000}
        />
      </div>
      <ProjectCheckboxes
        projects={projects}
        selected={projectIds}
        onChange={setProjectIds}
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter className="-mx-3 -mb-3 p-3">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            取消
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? '保存中…' : '保存链接'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(`${BACKEND}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description.trim() || null })
      });
      if (!response.ok) throw new Error('无法创建 Project。');
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法创建 Project。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5">
        <Label htmlFor="project-name">名称</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={32}
          autoFocus
          required
        />
        <p className="text-[10px] text-muted-foreground">最多 32 个字符</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="project-description">
          说明 <span className="font-normal text-muted-foreground">可选</span>
        </Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2_000}
          className="min-h-16 text-xs"
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter className="-mx-3 -mb-3 p-3">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            取消
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? '创建中…' : '创建 Project'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MembershipForm({
  source,
  projects,
  onSaved
}: {
  source: Source;
  projects: Project[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(source.projectIds);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(
        `${BACKEND}/api/sources/${source.id}/projects`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds: selected })
        }
      );
      if (!response.ok) throw new Error('无法更新 Project 关联。');
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '无法更新 Project 关联。'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <ProjectCheckboxes
        projects={projects}
        selected={selected}
        onChange={setSelected}
      />
      <p className="text-[11px] text-muted-foreground">
        不选择任何 Project 时，Source 会回到 Inbox。
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter className="-mx-3 -mb-3 p-3">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            取消
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? '保存中…' : '保存关联'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProjectCheckboxes({
  projects,
  selected,
  onChange
}: {
  projects: Project[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (projects.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        尚无 Project，将保存到 Inbox。
      </p>
    );
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-xs font-medium">关联到 Project</legend>
      {projects.map((project) => {
        const checked = selected.includes(project.id);
        return (
          <Label
            key={project.id}
            className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 font-normal hover:bg-muted"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() =>
                onChange(
                  checked
                    ? selected.filter((id) => id !== project.id)
                    : [...selected, project.id]
                )
              }
            />
            <span className="truncate">{project.name}</span>
          </Label>
        );
      })}
    </fieldset>
  );
}

function CaptureResults({
  results,
  onDismiss
}: {
  results: CaptureResult[];
  onDismiss: () => void;
}) {
  const successes = results.filter((item) => item.ok).length;
  const failures = results.filter((item) => !item.ok);
  return (
    <Alert className="mb-2">
      <AlertDescription className="flex items-start gap-2">
        <span className="flex-1">
          {successes ? `已保存 ${successes} 个标签页。` : '没有标签页被保存。'}
          {failures.map((item) => (
            <span key={item.clientRequestId} className="block text-destructive">
              {item.message}
            </span>
          ))}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onDismiss}
          aria-label="关闭结果"
        >
          ×
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function SourceListSkeleton() {
  return (
    <div className="space-y-2 pt-1">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="flex items-center gap-2 py-1.5">
          <Skeleton className="size-7 rounded-md" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalysisPanel({
  source,
  projects
}: {
  source: Source;
  projects: Project[];
}) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [projectId, setProjectId] = useState(source.projectIds[0] ?? '');
  const [insights, setInsights] = useState<ProjectInsight[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [conversationOpen, setConversationOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadAnalyses = useCallback(async () => {
    const response = await authFetch(
      `${BACKEND}/api/sources/${source.id}/analyses`
    );
    if (!response.ok) throw new Error('无法加载 Analysis history。');
    const body = (await response.json()) as {
      analyses: Analysis[];
      runs: AnalysisRun[];
    };
    setAnalyses(body.analyses);
    setRuns(body.runs);
    setSelectedVersion(
      (current) => current ?? body.analyses[0]?.version ?? null
    );
  }, [source.id]);
  const loadContext = useCallback(async () => {
    if (projectId) {
      const response = await authFetch(
        `${BACKEND}/api/sources/${source.id}/insights?projectId=${projectId}`
      );
      if (response.ok)
        setInsights(
          ((await response.json()) as { insights: ProjectInsight[] }).insights
        );
    } else setInsights([]);
    const response = await authFetch(
      `${BACKEND}/api/threads?sourceId=${source.id}${projectId ? `&projectId=${projectId}` : ''}`
    );
    if (response.ok) {
      const next =
        ((await response.json()) as { threads: Thread[] }).threads[0] ?? null;
      setThread(next);
      if (next) {
        const messageResponse = await authFetch(
          `${BACKEND}/api/threads/${next.id}/messages`
        );
        setMessages(
          messageResponse.ok
            ? ((await messageResponse.json()) as { messages: ThreadMessage[] })
                .messages
            : []
        );
      } else setMessages([]);
    }
  }, [projectId, source.id]);
  useEffect(() => {
    void loadAnalyses().catch((caught) =>
      setError(caught instanceof Error ? caught.message : '无法加载 Analysis。')
    );
  }, [loadAnalyses]);
  useEffect(() => {
    void loadContext();
  }, [loadContext]);
  const selectedAnalysis =
    analyses.find((item) => item.version === selectedVersion) ?? analyses[0];
  const analyze = async () => {
    setBusy('analysis');
    setError(null);
    try {
      let pageText: string | undefined;
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (
        tab?.id &&
        tab.url &&
        canonicalForComparison(tab.url) ===
          canonicalForComparison(source.originalUrl)
      ) {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body?.innerText.slice(0, 120_000) ?? ''
        });
        pageText =
          typeof result[0]?.result === 'string' ? result[0].result : undefined;
      }
      const response = await authFetch(
        `${BACKEND}/api/sources/${source.id}/analyses`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageText,
            extraction: {
              method: pageText ? 'active_tab_text' : 'metadata_only',
              contentLength: pageText?.length ?? 0
            }
          })
        }
      );
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.message || 'Analysis 失败；先前版本仍然保留。');
      await loadAnalyses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analysis 失败。');
    } finally {
      setBusy(null);
    }
  };
  const createInsight = async () => {
    if (!projectId || !selectedAnalysis) return;
    setBusy('insight');
    setError(null);
    try {
      const response = await authFetch(
        `${BACKEND}/api/sources/${source.id}/insights`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            sourceAnalysisId: selectedAnalysis.id
          })
        }
      );
      if (!response.ok) throw new Error('无法生成 Why It Matters。');
      await loadContext();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '无法生成 Project Insight。'
      );
    } finally {
      setBusy(null);
    }
  };
  const ask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy('chat');
    setError(null);
    try {
      let target = thread;
      if (!target) {
        const created = await authFetch(`${BACKEND}/api/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: source.id,
            projectId: projectId || undefined,
            title: source.title
          })
        });
        if (!created.ok) throw new Error('无法创建 Conversation。');
        target = ((await created.json()) as { thread: Thread }).thread;
        setThread(target);
      }
      const response = await authFetch(
        `${BACKEND}/api/threads/${target.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: [{ type: 'text', text: question.trim() }],
            sourceAnalysisId: selectedAnalysis?.id,
            projectInsightId: insights[0]?.id
          })
        }
      );
      if (!response.ok)
        throw new Error('Relata 暂时无法回答；你的问题仍已保存。');
      setQuestion('');
      await loadContext();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Conversation 失败。'
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <DialogContent className="!flex h-[min(80dvh,640px)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 shrink-0 gap-1 border-b px-3 py-3 pr-11">
          <DialogTitle className="min-w-0 break-words text-base leading-6 [overflow-wrap:anywhere]">
            {source.title}
          </DialogTitle>
          <DialogDescription>AI Context</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" className="mx-3 mt-3 shrink-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void analyze()}
                disabled={busy !== null}
              >
                <Sparkles />
                {busy === 'analysis'
                  ? '分析中…'
                  : analyses.length
                    ? '重新分析'
                    : '生成 Summary'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConversationOpen(true)}
                disabled={!selectedAnalysis}
              >
                <MessageCircle />
                讨论
              </Button>
              {analyses.length > 1 && (
                <Select
                  value={String(selectedVersion ?? '')}
                  onValueChange={(value) => setSelectedVersion(Number(value))}
                >
                  <SelectTrigger size="sm" className="ml-auto w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {analyses.map((item) => (
                      <SelectItem key={item.id} value={String(item.version)}>
                        Version {item.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {runs.some((run) => run.status === 'failed') && (
              <p className="text-[11px] text-muted-foreground">
                最近失败不会覆盖成功版本 ·{' '}
                {runs.find((run) => run.status === 'failed')?.errorCode}
              </p>
            )}
            {selectedAnalysis ? (
              <>
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold">Summary</h3>
                    <Badge variant="secondary">
                      V{selectedAnalysis.version}
                    </Badge>
                  </div>
                  <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
                    {selectedAnalysis.summary}
                  </p>
                  {selectedAnalysis.keyPoints.length > 0 && (
                    <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                      {selectedAnalysis.keyPoints.map((point) => (
                        <li
                          key={point}
                          className="break-words [overflow-wrap:anywhere]"
                        >
                          {point}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {selectedAnalysis.topics.map((topic) => (
                      <Badge
                        key={topic}
                        variant="outline"
                        className="max-w-full break-words whitespace-normal"
                      >
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </section>
                <Separator />
                {source.projectIds.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold">Why It Matters</h3>
                      <Select value={projectId} onValueChange={setProjectId}>
                        <SelectTrigger size="sm" className="max-w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {projects
                            .filter((project) =>
                              source.projectIds.includes(project.id)
                            )
                            .map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {insights[0] ? (
                      <>
                        <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
                          {insights[0].whyItMatters}
                        </p>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                          {insights[0].implications.map((item) => (
                            <li
                              key={item}
                              className="break-words [overflow-wrap:anywhere]"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void createInsight()}
                        disabled={busy !== null}
                      >
                        {busy === 'insight'
                          ? '生成中…'
                          : '生成 Project Insight'}
                      </Button>
                    )}
                  </section>
                )}
              </>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                尚无 Analysis。页面正文只在请求中临时使用。
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
      <Dialog open={conversationOpen} onOpenChange={setConversationOpen}>
        <ConversationPanel
          source={source}
          messages={messages}
          question={question}
          onQuestionChange={setQuestion}
          onAsk={ask}
          canAsk={Boolean(selectedAnalysis)}
          busy={busy === 'chat'}
          error={error}
        />
      </Dialog>
    </>
  );
}

function ConversationPanel({
  source,
  messages,
  question,
  onQuestionChange,
  onAsk,
  canAsk,
  busy,
  error
}: {
  source: Source;
  messages: ThreadMessage[];
  question: string;
  onQuestionChange: (question: string) => void;
  onAsk: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  canAsk: boolean;
  busy: boolean;
  error: string | null;
}) {
  return (
    <DialogContent className="!flex h-[min(76dvh,600px)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="min-w-0 shrink-0 gap-1 border-b px-3 py-3 pr-11">
        <DialogTitle>讨论</DialogTitle>
        <DialogDescription className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
          {source.title}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <Alert variant="destructive" className="mx-3 mt-3 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageScroller className="flex-1">
            <MessageScrollerViewport aria-label="讨论记录">
              <MessageScrollerContent aria-busy={busy} className="gap-2 p-3">
                {messages.length === 0 ? (
                  <p className="m-auto max-w-52 text-center text-xs leading-5 text-muted-foreground">
                    基于当前 Analysis 继续讨论。
                  </p>
                ) : (
                  messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                      className={`max-w-[90%] rounded-lg px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere] ${message.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
                    >
                      {message.content
                        .filter((part) => part.type === 'text')
                        .map((part) => part.text)
                        .join('\n')}
                    </MessageScrollerItem>
                  ))
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="bottom-3" />
          </MessageScroller>
          <form
            className="flex shrink-0 items-end gap-2 border-t bg-background p-3"
            onSubmit={(event) => void onAsk(event)}
          >
            <Textarea
              aria-label="Ask Relata"
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Ask Relata…"
              className="max-h-32 min-h-14 flex-1 resize-none text-xs leading-5"
            />
            <Button
              type="submit"
              size="icon-sm"
              className="mb-0.5"
              disabled={!canAsk || !question.trim() || busy}
              aria-label="发送"
            >
              <ArrowUp />
            </Button>
          </form>
        </div>
      </MessageScrollerProvider>
    </DialogContent>
  );
}

function AuthGate({
  onAuthenticated
}: {
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user =
        mode === 'sign-in'
          ? await signInWithEmail(BACKEND, email, password)
          : await registerWithEmail(
              BACKEND,
              email,
              password,
              name.trim() || undefined
            );
      onAuthenticated(user);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '登录失败，请稍后再试。'
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="grid min-h-screen place-items-center bg-background p-5">
      <form
        className="grid w-full max-w-xs gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <div className="mb-2 grid justify-items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <UserRound className="size-4" />
          </span>
          <h1 className="text-base font-semibold">
            {mode === 'sign-in' ? '登录 Relata' : '创建账号'}
          </h1>
        </div>
        {mode === 'register' && (
          <div className="grid gap-1.5">
            <Label htmlFor="auth-name">名称</Label>
            <Input
              id="auth-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">邮箱</Label>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-password">密码</Label>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === 'sign-in' ? 'current-password' : 'new-password'
            }
            minLength={10}
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? '请稍候…' : mode === 'sign-in' ? '登录' : '创建账号'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() =>
            setMode((current) =>
              current === 'sign-in' ? 'register' : 'sign-in'
            )
          }
        >
          {mode === 'sign-in' ? '没有账号？创建一个' : '已有账号？登录'}
        </Button>
      </form>
    </main>
  );
}

function isCaptureResultMessage(
  value: unknown
): value is { type: 'RELATA_CAPTURE_RESULTS'; payload: CaptureResult[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'RELATA_CAPTURE_RESULTS' &&
    'payload' in value &&
    Array.isArray(value.payload)
  );
}
function domainFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
function canonicalForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}
function initials(value: string): string {
  return (
    value
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'R'
  );
}
function inboxRangeQuery(range: InboxRange): string {
  const params = new URLSearchParams({ inbox: 'true' });
  if (range === 'all') return params.toString();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (range === '7d') from.setDate(from.getDate() - 6);
  if (range === '30d') from.setDate(from.getDate() - 29);
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 1);
  params.set('from', from.toISOString());
  params.set('to', to.toISOString());
  return params.toString();
}
function relativeTime(value: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1_000)
  );
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
