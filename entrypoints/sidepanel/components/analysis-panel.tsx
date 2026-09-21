import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { authFetch } from '@/lib/auth';
import { BACKEND } from '@/lib/source-saving';
import type {
  Analysis,
  AnalysisRun,
  Project,
  ProjectInsight,
  Source,
  Thread,
  ThreadMessage
} from '../types';
import { canonicalForComparison } from '../utils';
import { ConversationPanel } from './conversation-panel';

export function AnalysisDialog({
  source,
  projects,
  onOpenChange
}: {
  source: Source | null;
  projects: Project[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      {source && <AnalysisPanel source={source} projects={projects} />}
    </Dialog>
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
      if (response.ok) {
        setInsights(
          ((await response.json()) as { insights: ProjectInsight[] }).insights
        );
      }
    } else {
      setInsights([]);
    }

    const response = await authFetch(
      `${BACKEND}/api/threads?sourceId=${source.id}${projectId ? `&projectId=${projectId}` : ''}`
    );
    if (!response.ok) return;

    const next =
      ((await response.json()) as { threads: Thread[] }).threads[0] ?? null;
    setThread(next);
    if (!next) {
      setMessages([]);
      return;
    }

    const messageResponse = await authFetch(
      `${BACKEND}/api/threads/${next.id}/messages`
    );
    setMessages(
      messageResponse.ok
        ? ((await messageResponse.json()) as { messages: ThreadMessage[] })
            .messages
        : []
    );
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
      if (!response.ok) {
        throw new Error(body?.message || 'Analysis 失败；先前版本仍然保留。');
      }
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
      if (!response.ok) {
        throw new Error('Relata 暂时无法回答；你的问题仍已保存。');
      }
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
            <AnalysisActions
              analyses={analyses}
              selectedVersion={selectedVersion}
              onVersionChange={setSelectedVersion}
              onAnalyze={analyze}
              onDiscuss={() => setConversationOpen(true)}
              busy={busy}
              canDiscuss={Boolean(selectedAnalysis)}
            />
            {runs.some((run) => run.status === 'failed') && (
              <p className="text-[11px] text-muted-foreground">
                最近失败不会覆盖成功版本 ·{' '}
                {runs.find((run) => run.status === 'failed')?.errorCode}
              </p>
            )}
            {selectedAnalysis ? (
              <AnalysisSummary
                analysis={selectedAnalysis}
                source={source}
                projects={projects}
                projectId={projectId}
                onProjectChange={setProjectId}
                insight={insights[0]}
                onCreateInsight={createInsight}
                busy={busy}
              />
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

function AnalysisActions({
  analyses,
  selectedVersion,
  onVersionChange,
  onAnalyze,
  onDiscuss,
  busy,
  canDiscuss
}: {
  analyses: Analysis[];
  selectedVersion: number | null;
  onVersionChange: (version: number) => void;
  onAnalyze: () => Promise<void>;
  onDiscuss: () => void;
  busy: string | null;
  canDiscuss: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={() => void onAnalyze()}
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
        onClick={onDiscuss}
        disabled={!canDiscuss}
      >
        <MessageCircle />
        讨论
      </Button>
      {analyses.length > 1 && (
        <Select
          value={String(selectedVersion ?? '')}
          onValueChange={(value) => onVersionChange(Number(value))}
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
  );
}

function AnalysisSummary({
  analysis,
  source,
  projects,
  projectId,
  onProjectChange,
  insight,
  onCreateInsight,
  busy
}: {
  analysis: Analysis;
  source: Source;
  projects: Project[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  insight: ProjectInsight | undefined;
  onCreateInsight: () => Promise<void>;
  busy: string | null;
}) {
  return (
    <>
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold">Summary</h3>
          <Badge variant="secondary">V{analysis.version}</Badge>
        </div>
        <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
          {analysis.summary}
        </p>
        {analysis.keyPoints.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {analysis.keyPoints.map((point) => (
              <li key={point} className="break-words [overflow-wrap:anywhere]">
                {point}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-1">
          {analysis.topics.map((topic) => (
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
            <Select value={projectId} onValueChange={onProjectChange}>
              <SelectTrigger size="sm" className="max-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects
                  .filter((project) => source.projectIds.includes(project.id))
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {insight ? (
            <>
              <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
                {insight.whyItMatters}
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {insight.implications.map((item) => (
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
              onClick={() => void onCreateInsight()}
              disabled={busy !== null}
            >
              {busy === 'insight' ? '生成中…' : '生成 Project Insight'}
            </Button>
          )}
        </section>
      )}
    </>
  );
}
