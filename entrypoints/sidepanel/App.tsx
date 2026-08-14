import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  authFetch,
  getAuthToken,
  getStoredAuthUser,
  refreshAuthUser,
  registerWithEmail,
  signInWithEmail,
  signOut,
  subscribeAuth,
  type AuthUser,
} from '@/lib/auth';
import { BACKEND, captureItemFromTab, submitCaptures, type CaptureResult } from '@/lib/capture';

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

  if (authState.kind === 'loading') return <main className="relata-shell relata-center">正在检查登录状态…</main>;
  if (authState.kind === 'signed-out') {
    return <AuthGate onAuthenticated={(user) => setAuthState({ kind: 'signed-in', user })} />;
  }
  return <RelataHome user={authState.user} onSignedOut={() => setAuthState({ kind: 'signed-out' })} />;
}

function RelataHome({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [analyzingSource, setAnalyzingSource] = useState<Source | null>(null);
  const [results, setResults] = useState<CaptureResult[]>([]);
  const [signingOut, setSigningOut] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResponse, sourceResponse] = await Promise.all([
        authFetch(`${BACKEND}/api/projects`),
        authFetch(`${BACKEND}/api/sources`),
      ]);
      if (!projectResponse.ok || !sourceResponse.ok) throw new Error('无法加载你的保存内容。');
      const [projectBody, sourceBody] = await Promise.all([
        projectResponse.json() as Promise<{ projects: Project[] }>,
        sourceResponse.json() as Promise<{ sources: Source[] }>,
      ]);
      setProjects(projectBody.projects);
      setSources(sourceBody.sources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载你的保存内容。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isCaptureResultMessage(message)) return;
      setResults(message.payload);
      void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const inboxSources = useMemo(
    () => sources.filter((source) => source.projectIds.length === 0),
    [sources],
  );
  const sourcesByProject = useMemo(() => new Map(
    projects.map((project) => [project.id, sources.filter((source) => source.projectIds.includes(project.id))]),
  ), [projects, sources]);

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
    <main className="relata-shell">
      <header className="relata-header">
        <div>
          <p className="relata-brand">Relata</p>
          <p className="relata-slogan">Connect what you discover to what you&apos;re working on.</p>
        </div>
        <button className="relata-text-button" onClick={() => void handleSignOut()} disabled={signingOut}>
          {signingOut ? '退出中…' : '退出'}
        </button>
      </header>

      <section className="relata-actions" aria-label="保存与项目操作">
        <button className="relata-primary-button" onClick={() => setCaptureOpen((open) => !open)}>
          保存当前标签页
        </button>
        <button className="relata-outline-button" onClick={() => setCreatingProject((open) => !open)}>
          新建 Project
        </button>
      </section>

      {captureOpen && <CaptureForm projects={projects} onResult={(nextResults) => { setResults(nextResults); void refresh(); }} />}
      {creatingProject && <ProjectForm onCreated={() => { setCreatingProject(false); void refresh(); }} />}
      {editingSource && (
        <MembershipForm
          source={editingSource}
          projects={projects}
          onSaved={() => { setEditingSource(null); void refresh(); }}
          onCancel={() => setEditingSource(null)}
        />
      )}
      {analyzingSource && (
        <AnalysisPanel source={analyzingSource} projects={projects} onClose={() => setAnalyzingSource(null)} />
      )}

      {results.length > 0 && <CaptureResults results={results} onDismiss={() => setResults([])} />}
      {error && <p className="relata-error relata-page-error" role="alert">{error}</p>}

      <div className="relata-list" aria-busy={loading}>
        {loading ? <p className="relata-muted">正在加载保存内容…</p> : (
          <>
            <SourceGroup
              label="INBOX"
              title="Inbox"
              sources={inboxSources}
              empty="保存网页后，未关联 Project 的内容会在这里出现。"
              onEditMembership={setEditingSource}
              onAnalyze={setAnalyzingSource}
            />
            {projects.map((project) => (
              <SourceGroup
                key={project.id}
                label="PROJECT"
                title={project.name}
                sources={sourcesByProject.get(project.id) ?? []}
                empty="尚未关联任何 Source。"
                onEditMembership={setEditingSource}
                onAnalyze={setAnalyzingSource}
              />
            ))}
          </>
        )}
      </div>

      <p className="relata-footer">已登录为 {user.email}</p>
    </main>
  );
}

function SourceGroup({
  label,
  title,
  sources,
  empty,
  onEditMembership,
  onAnalyze,
}: {
  label: string;
  title: string;
  sources: Source[];
  empty: string;
  onEditMembership: (source: Source) => void;
  onAnalyze: (source: Source) => void;
}) {
  return (
    <section className="relata-group">
      <p className="relata-eyebrow">{label}</p>
      <h2>{title}</h2>
      {sources.length === 0 ? <p className="relata-muted relata-group-empty">{empty}</p> : (
        <ul className="relata-source-list">
          {sources.map((source) => <SourceRow key={source.id} source={source} onEditMembership={onEditMembership} onAnalyze={onAnalyze} />)}
        </ul>
      )}
    </section>
  );
}

function SourceRow({ source, onEditMembership, onAnalyze }: { source: Source; onEditMembership: (source: Source) => void; onAnalyze: (source: Source) => void }) {
  return (
    <li className="relata-source-row">
      {source.faviconUrl ? (
        <img className="relata-favicon" src={source.faviconUrl} alt="" />
      ) : <span className="relata-favicon relata-favicon-fallback" aria-hidden="true">R</span>}
      <div className="relata-source-copy">
        <a className="relata-source-title" href={source.originalUrl} target="_blank" rel="noreferrer" title={source.title}>
          {source.title}
        </a>
        <p>{domainFor(source.originalUrl)} · {relativeTime(source.lastCapturedAt)}</p>
      </div>
      <div className="relata-row-actions">
        <button className="relata-row-action" onClick={() => onAnalyze(source)} aria-label={`分析 ${source.title}`} title="分析与讨论">分析</button>
        <button className="relata-row-action" onClick={() => onEditMembership(source)} aria-label={`编辑 ${source.title} 的 Project 关联`} title="编辑 Project 关联">关联</button>
      </div>
    </li>
  );
}

function CaptureForm({ projects, onResult }: { projects: Project[]; onResult: (results: CaptureResult[]) => void }) {
  const [intent, setIntent] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const item = tab ? captureItemFromTab(tab, 'side_panel') : null;
      if (!item) throw new Error('当前标签页无法保存。');
      const result = await submitCaptures([{ ...item, intent: intent.trim() || undefined, projectIds }]);
      onResult(result);
      if (result.some((itemResult) => itemResult.ok)) {
        setIntent('');
        setProjectIds([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '当前标签页无法保存。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="relata-form" onSubmit={(event) => void submit(event)}>
      <h2>保存当前标签页</h2>
      <label>
        Intent（可选）
        <textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="为什么保存它？" maxLength={4_000} />
      </label>
      <ProjectCheckboxes projects={projects} selected={projectIds} onChange={setProjectIds} />
      {error && <p className="relata-error" role="alert">{error}</p>}
      <button className="relata-primary-button" type="submit" disabled={saving}>{saving ? '保存中…' : '保存到 Relata'}</button>
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
        body: JSON.stringify({ name, description: description.trim() || null }),
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
    <form className="relata-form" onSubmit={(event) => void submit(event)}>
      <h2>新建 Project</h2>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
      <label>说明（可选）<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2_000} /></label>
      {error && <p className="relata-error" role="alert">{error}</p>}
      <button className="relata-primary-button" type="submit" disabled={saving}>{saving ? '创建中…' : '创建 Project'}</button>
    </form>
  );
}

function MembershipForm({ source, projects, onSaved, onCancel }: { source: Source; projects: Project[]; onSaved: () => void; onCancel: () => void }) {
  const [selected, setSelected] = useState(source.projectIds);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(`${BACKEND}/api/sources/${source.id}/projects`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: selected }),
      });
      if (!response.ok) throw new Error('无法更新 Project 关联。');
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法更新 Project 关联。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="relata-form" onSubmit={(event) => void submit(event)}>
      <h2>关联 Project</h2>
      <p className="relata-muted">{source.title}</p>
      <ProjectCheckboxes projects={projects} selected={selected} onChange={setSelected} />
      <p className="relata-muted">不选择任何 Project 即会将它放回 Inbox。</p>
      {error && <p className="relata-error" role="alert">{error}</p>}
      <div className="relata-form-actions">
        <button className="relata-primary-button" type="submit" disabled={saving}>{saving ? '保存中…' : '保存关联'}</button>
        <button className="relata-text-button" type="button" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

function ProjectCheckboxes({ projects, selected, onChange }: { projects: Project[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (projects.length === 0) return <p className="relata-muted">尚无 Project；不选择即保存到 Inbox。</p>;
  return (
    <fieldset className="relata-project-choices">
      <legend>关联到 Project（可多选）</legend>
      {projects.map((project) => {
        const checked = selected.includes(project.id);
        return <label key={project.id}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== project.id) : [...selected, project.id])} />{project.name}</label>;
      })}
    </fieldset>
  );
}

function CaptureResults({ results, onDismiss }: { results: CaptureResult[]; onDismiss: () => void }) {
  const successCount = results.filter((result) => result.ok).length;
  const failures = results.filter((result) => !result.ok);
  return (
    <section className="relata-results" aria-live="polite">
      <p>{successCount > 0 ? `已保存 ${successCount} 个标签页。` : '没有标签页被保存。'}</p>
      {failures.map((result, index) => <p key={`${result.clientRequestId}-${index}`} className="relata-error">{result.message}</p>)}
      <button className="relata-text-button" onClick={onDismiss}>关闭</button>
    </section>
  );
}

type Analysis = { id: string; version: number; summary: string; keyPoints: string[]; topics: string[]; entities: Array<{ name: string; type?: string }>; contentType: string | null; createdAt: string };
type AnalysisRun = { id: string; status: string; errorCode: string | null; createdAt: string };
type ProjectInsight = { id: string; version: number; whyItMatters: string; implications: string[] };
type Thread = { id: string; title: string | null };
type ThreadMessage = { id: string; role: string; content: Array<{ type: string; text?: string }>; sourceAnalysisId: string | null; projectInsightId: string | null };

function AnalysisPanel({ source, projects, onClose }: { source: Source; projects: Project[]; onClose: () => void }) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [projectId, setProjectId] = useState(source.projectIds[0] ?? '');
  const [insights, setInsights] = useState<ProjectInsight[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAnalyses = useCallback(async () => {
    const response = await authFetch(`${BACKEND}/api/sources/${source.id}/analyses`);
    if (!response.ok) throw new Error('无法加载 Analysis history。');
    const body = await response.json() as { analyses: Analysis[]; runs: AnalysisRun[] };
    setAnalyses(body.analyses); setRuns(body.runs); setSelectedVersion((current) => current ?? body.analyses[0]?.version ?? null);
  }, [source.id]);

  const loadContext = useCallback(async () => {
    if (projectId) {
      const insightResponse = await authFetch(`${BACKEND}/api/sources/${source.id}/insights?projectId=${projectId}`);
      if (insightResponse.ok) setInsights(((await insightResponse.json()) as { insights: ProjectInsight[] }).insights);
    } else setInsights([]);
    const threadResponse = await authFetch(`${BACKEND}/api/threads?sourceId=${source.id}${projectId ? `&projectId=${projectId}` : ''}`);
    if (threadResponse.ok) {
      const nextThread = ((await threadResponse.json()) as { threads: Thread[] }).threads[0] ?? null;
      setThread(nextThread);
      if (nextThread) {
        const messageResponse = await authFetch(`${BACKEND}/api/threads/${nextThread.id}/messages`);
        setMessages(messageResponse.ok ? ((await messageResponse.json()) as { messages: ThreadMessage[] }).messages : []);
      } else setMessages([]);
    }
  }, [projectId, source.id]);

  useEffect(() => { void loadAnalyses().catch((caught) => setError(caught instanceof Error ? caught.message : '无法加载 Analysis。')); }, [loadAnalyses]);
  useEffect(() => { void loadContext(); }, [loadContext]);
  const selectedAnalysis = analyses.find((analysis) => analysis.version === selectedVersion) ?? analyses[0];

  const analyze = async () => {
    setBusy('analysis'); setError(null);
    try {
      let pageText: string | undefined;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url && canonicalForComparison(tab.url) === canonicalForComparison(source.originalUrl)) {
        const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.body?.innerText.slice(0, 120_000) ?? '' });
        pageText = typeof result[0]?.result === 'string' ? result[0].result : undefined;
      }
      const response = await authFetch(`${BACKEND}/api/sources/${source.id}/analyses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageText, extraction: { method: pageText ? 'active_tab_text' : 'metadata_only', contentLength: pageText?.length ?? 0 } }) });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message || 'Analysis 失败；先前版本仍然保留。');
      await loadAnalyses();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Analysis 失败。'); }
    finally { setBusy(null); }
  };

  const createInsight = async () => {
    if (!projectId || !selectedAnalysis) return; setBusy('insight'); setError(null);
    try {
      const response = await authFetch(`${BACKEND}/api/sources/${source.id}/insights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, sourceAnalysisId: selectedAnalysis.id }) });
      if (!response.ok) throw new Error('无法生成 Why It Matters。');
      await loadContext();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法生成 Project Insight。'); }
    finally { setBusy(null); }
  };

  const ask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!question.trim()) return; setBusy('chat'); setError(null);
    try {
      let target = thread;
      if (!target) {
        const created = await authFetch(`${BACKEND}/api/threads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id, projectId: projectId || undefined, title: source.title }) });
        if (!created.ok) throw new Error('无法创建 Conversation。');
        target = ((await created.json()) as { thread: Thread }).thread; setThread(target);
      }
      const response = await authFetch(`${BACKEND}/api/threads/${target.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: question.trim() }], sourceAnalysisId: selectedAnalysis?.id, projectInsightId: insights[0]?.id }) });
      if (!response.ok) throw new Error('Relata 暂时无法回答；你的问题仍已保存。');
      setQuestion(''); await loadContext();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Conversation 失败。'); }
    finally { setBusy(null); }
  };

  return (
    <section className="relata-analysis" aria-label={`${source.title} 的 AI Context`}>
      <div className="relata-analysis-header"><div><p className="relata-eyebrow">AI CONTEXT</p><h2>{source.title}</h2></div><button className="relata-text-button" onClick={onClose}>关闭</button></div>
      <div className="relata-form-actions"><button className="relata-primary-button" onClick={() => void analyze()} disabled={busy !== null}>{busy === 'analysis' ? '分析中…' : analyses.length ? '重新分析' : '生成 Summary'}</button>{analyses.length > 1 && <select aria-label="Analysis version" value={selectedVersion ?? ''} onChange={(event) => setSelectedVersion(Number(event.target.value))}>{analyses.map((analysis) => <option key={analysis.id} value={analysis.version}>Version {analysis.version}</option>)}</select>}</div>
      {error && <p className="relata-error" role="alert">{error}</p>}
      {runs.some((run) => run.status === 'failed') && <p className="relata-muted">最近一次失败不会覆盖成功版本（{runs.find((run) => run.status === 'failed')?.errorCode}）。</p>}
      {selectedAnalysis ? <article className="relata-analysis-card"><p className="relata-eyebrow">SUMMARY · V{selectedAnalysis.version}</p><p>{selectedAnalysis.summary}</p>{selectedAnalysis.keyPoints.length > 0 && <ul>{selectedAnalysis.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>}<div className="relata-tags">{selectedAnalysis.topics.map((topic) => <span key={topic}>{topic}</span>)}</div></article> : <p className="relata-muted">尚无 Analysis。页面正文只在本次请求中临时使用，不会保存。</p>}
      {source.projectIds.length > 0 && <div className="relata-analysis-card"><p className="relata-eyebrow">WHY IT MATTERS</p><select aria-label="选择 Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.filter((project) => source.projectIds.includes(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{insights[0] ? <><p>{insights[0].whyItMatters}</p><ul>{insights[0].implications.map((item) => <li key={item}>{item}</li>)}</ul></> : <button className="relata-outline-button" onClick={() => void createInsight()} disabled={!selectedAnalysis || busy !== null}>{busy === 'insight' ? '生成中…' : '生成 Project Insight'}</button>}</div>}
      <div className="relata-analysis-card"><p className="relata-eyebrow">ASK RELATA</p><div className="relata-conversation">{messages.map((message) => <p key={message.id} className={`relata-message relata-message-${message.role}`}><strong>{message.role === 'user' ? '你' : 'Relata'}：</strong>{message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')}</p>)}</div><form onSubmit={(event) => void ask(event)}><textarea aria-label="Ask Relata" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="基于保存的 Analysis 继续讨论…" required /><button className="relata-primary-button" disabled={!selectedAnalysis || busy !== null}>{busy === 'chat' ? '回答中…' : '发送'}</button></form></div>
    </section>
  );
}

function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
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
      const user = mode === 'sign-in'
        ? await signInWithEmail(BACKEND, email, password)
        : await registerWithEmail(BACKEND, email, password, name.trim() || undefined);
      onAuthenticated(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relata-shell relata-center">
      <form className="relata-auth-card" onSubmit={(event) => void submit(event)}>
        <span className="relata-mark" aria-hidden="true">R</span>
        <p className="relata-brand">Relata</p>
        <h1>{mode === 'sign-in' ? '登录以保存关联' : '创建 Relata 帐号'}</h1>
        <p className="relata-slogan">Connect what you discover to what you&apos;re working on.</p>
        {mode === 'register' && <label>名称<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
        <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={10} required /></label>
        {error && <p className="relata-error" role="alert">{error}</p>}
        <button className="relata-primary-button" type="submit" disabled={submitting}>{submitting ? '请稍候…' : mode === 'sign-in' ? '登录' : '创建帐号'}</button>
        <button className="relata-text-button" type="button" onClick={() => setMode((current) => current === 'sign-in' ? 'register' : 'sign-in')}>
          {mode === 'sign-in' ? '没有帐号？创建一个' : '已有帐号？登录'}
        </button>
      </form>
    </main>
  );
}

function isCaptureResultMessage(value: unknown): value is { type: 'RELATA_CAPTURE_RESULTS'; payload: CaptureResult[] } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'RELATA_CAPTURE_RESULTS'
    && 'payload' in value && Array.isArray(value.payload);
}

function domainFor(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function canonicalForComparison(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.toString(); } catch { return value; }
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
