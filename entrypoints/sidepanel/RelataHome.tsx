import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { authFetch, signOut, type AuthUser } from '@/lib/auth';
import { BACKEND, type SourceSaveResult } from '@/lib/source-saving';
import { AnalysisDialog } from './components/analysis-panel';
import {
  CaptureDialog,
  CaptureResults,
  CreateProjectDialog,
  MembershipDialog,
  MemoDialog
} from './components/library-dialogs';
import { SidePanelHeader } from './components/sidepanel-header';
import {
  InboxGroup,
  ProjectList,
  PinnedSources,
  SourceListSkeleton
} from './components/source-lists';
import type { Project, Source } from './types';
import { useLibraryData } from './use-library-data';
import { isCaptureResultMessage } from './utils';

export function RelataHome({
  user,
  onSignedOut
}: {
  user: AuthUser;
  onSignedOut: () => void;
}) {
  const library = useLibraryData();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [memoSource, setMemoSource] = useState<Source | null>(null);
  const [analyzingSource, setAnalyzingSource] = useState<Source | null>(null);
  const [results, setResults] = useState<SourceSaveResult[]>([]);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isCaptureResultMessage(message)) return;
      setResults(message.payload.filter((item) => !item.ok));
      library.applySaveResults(message.payload);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [library.applySaveResults]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(BACKEND);
    } finally {
      library.reset();
      onSignedOut();
      setSigningOut(false);
    }
  };

  const handleCaptureResults = (next: SourceSaveResult[]) => {
    setResults(next.filter((item) => !item.ok));
    if (next.some((item) => item.ok)) setCaptureOpen(false);
    library.applySaveResults(next);
  };
  const togglePin = async (source: Source) => {
    const response = await authFetch(`${BACKEND}/api/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !source.pinnedAt })
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      source: Pick<Source, 'id' | 'pinnedAt'>;
    };
    library.patchSource(body.source);
  };
  const deleteSource = async (source: Source) => {
    if (!window.confirm(`删除「${source.title}」？`)) return;
    const response = await authFetch(`${BACKEND}/api/sources/${source.id}`, {
      method: 'DELETE'
    });
    if (response.ok) library.removeSource(source.id);
  };
  const renameProject = async (project: { id: string; name: string }) => {
    const name = window.prompt('Project 名称', project.name)?.trim();
    if (!name || name === project.name) return;
    const response = await authFetch(`${BACKEND}/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!response.ok) return;
    const body = (await response.json()) as { project: Project };
    library.updateProject(body.project);
  };
  const deleteProject = async (project: { id: string; name: string }) => {
    if (
      !window.confirm(
        `删除 Project「${project.name}」？其中的 Sources 不会被删除。`
      )
    )
      return;
    const response = await authFetch(`${BACKEND}/api/projects/${project.id}`, {
      method: 'DELETE'
    });
    if (response.ok) library.removeProject(project.id);
  };
  const removeFromProject = async (source: Source, projectId: string) => {
    const projectIds = source.projectIds.filter((id) => id !== projectId);
    const response = await authFetch(
      `${BACKEND}/api/sources/${source.id}/projects`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds })
      }
    );
    if (!response.ok) return;
    const body = (await response.json()) as {
      sourceId: string;
      projectIds: string[];
    };
    library.replaceMemberships(body.sourceId, body.projectIds);
  };
  const sourceActions = {
    onAnalyze: setAnalyzingSource,
    onEditMembership: setEditingSource,
    onEditMemo: setMemoSource,
    onTogglePin: (source: Source) => void togglePin(source),
    onDeleteSource: (source: Source) => void deleteSource(source),
    onRemoveFromProject: (source: Source, projectId: string) =>
      void removeFromProject(source, projectId)
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <SidePanelHeader
        user={user}
        signingOut={signingOut}
        onCapture={() => setCaptureOpen(true)}
        onCreateProject={() => setProjectOpen(true)}
        onSignOut={() => void handleSignOut()}
      />
      <div className="py-2">
        {results.length > 0 && (
          <CaptureResults results={results} onDismiss={() => setResults([])} />
        )}
        {library.error && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>{library.error}</AlertDescription>
          </Alert>
        )}
        {library.loading ? (
          <SourceListSkeleton />
        ) : (
          <div className="space-y-2">
            <InboxGroup
              range={library.inboxRange}
              onRangeChange={library.setInboxRange}
              loading={library.inboxLoading}
              sources={library.inboxSources}
              {...sourceActions}
            />
            <ProjectList
              projects={library.projects}
              sourcesByProject={library.sourcesByProject}
              {...sourceActions}
              onRenameProject={(project) => void renameProject(project)}
              onDeleteProject={(project) => void deleteProject(project)}
            />
            <PinnedSources sources={library.pinnedSources} {...sourceActions} />
          </div>
        )}
      </div>
      <CaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        projects={library.projects}
        onCaptured={handleCaptureResults}
      />
      <CreateProjectDialog
        open={projectOpen}
        onOpenChange={setProjectOpen}
        onCreated={(project) => {
          library.addProject(project);
          setProjectOpen(false);
        }}
      />
      <MembershipDialog
        source={editingSource}
        projects={library.projects}
        onOpenChange={(open) => {
          if (!open) setEditingSource(null);
        }}
        onSaved={(sourceId, projectIds) => {
          library.replaceMemberships(sourceId, projectIds);
          setEditingSource(null);
        }}
      />
      <MemoDialog
        source={memoSource}
        onOpenChange={(open) => {
          if (!open) setMemoSource(null);
        }}
        onSaved={(source) => {
          library.patchSource(source);
          setMemoSource(null);
        }}
      />
      <AnalysisDialog
        source={analyzingSource}
        projects={library.projects}
        onOpenChange={(open) => {
          if (!open) setAnalyzingSource(null);
        }}
      />
    </main>
  );
}
