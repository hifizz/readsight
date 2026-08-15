import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { signOut, type AuthUser } from '@/lib/auth';
import { BACKEND, type CaptureResult } from '@/lib/capture';
import { AnalysisDialog } from './components/analysis-panel';
import {
  CaptureDialog,
  CaptureResults,
  CreateProjectDialog,
  MembershipDialog
} from './components/library-dialogs';
import { SidePanelHeader } from './components/sidepanel-header';
import {
  InboxGroup,
  ProjectList,
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
  const [analyzingSource, setAnalyzingSource] = useState<Source | null>(null);
  const [results, setResults] = useState<CaptureResult[]>([]);
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

  const handleCaptureResults = (next: CaptureResult[]) => {
    setResults(next);
    if (next.some((item) => item.ok)) setCaptureOpen(false);
    void library.refreshAll();
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
          <div className="space-y-4">
            <InboxGroup
              range={library.inboxRange}
              onRangeChange={library.setInboxRange}
              loading={library.inboxLoading}
              sources={library.inboxSources}
              onAnalyze={setAnalyzingSource}
              onEditMembership={setEditingSource}
            />
            <ProjectList
              projects={library.projects}
              sourcesByProject={library.sourcesByProject}
              onAnalyze={setAnalyzingSource}
              onEditMembership={setEditingSource}
            />
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
