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
import type { Source } from './types';
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
      setResults(message.payload);
      void library.refreshAll();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [library.refreshAll]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(BACKEND);
    } finally {
      onSignedOut();
      setSigningOut(false);
    }
  };

  const handleCaptureResults = (next: SourceSaveResult[]) => {
    setResults(next);
    if (next.some((item) => item.ok)) setCaptureOpen(false);
    void library.refreshAll();
  };
  const togglePin = async (source: Source) => {
    const response = await authFetch(`${BACKEND}/api/sources/${source.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !source.pinnedAt }) });
    if (!response.ok) return;
    const body = await response.json() as { source: Pick<Source, 'id' | 'pinnedAt'> };
    library.updateSource(body.source);
  };
  const sourceActions = { onAnalyze: setAnalyzingSource, onEditMembership: setEditingSource, onEditMemo: setMemoSource, onTogglePin: (source: Source) => void togglePin(source) };

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
            />
            <PinnedSources sources={library.pinnedSources} {...sourceActions}/>
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
        onCreated={() => {
          setProjectOpen(false);
          void library.refreshBase();
        }}
      />
      <MembershipDialog
        source={editingSource}
        projects={library.projects}
        onOpenChange={(open) => {
          if (!open) setEditingSource(null);
        }}
        onSaved={() => {
          setEditingSource(null);
          void library.refreshAll();
        }}
      />
      <MemoDialog source={memoSource} onOpenChange={(open) => { if (!open) setMemoSource(null); }} onSaved={() => { setMemoSource(null); void library.refreshAll(); }}/>
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
