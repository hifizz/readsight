import type { CaptureResult } from '@/lib/capture';
import type { AuthUser } from '@/lib/auth';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: AuthUser };

export type Project = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
};

export type Source = {
  id: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  faviconUrl: string | null;
  lastCapturedAt: string;
  projectIds: string[];
};

export type Analysis = {
  id: string;
  version: number;
  summary: string;
  keyPoints: string[];
  topics: string[];
  entities: Array<{ name: string; type?: string }>;
  contentType: string | null;
  createdAt: string;
};

export type AnalysisRun = {
  id: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
};

export type ProjectInsight = {
  id: string;
  version: number;
  whyItMatters: string;
  implications: string[];
};

export type Thread = { id: string; title: string | null };

export type ThreadMessage = {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  sourceAnalysisId: string | null;
  projectInsightId: string | null;
};

export type InboxRange = 'today' | '7d' | '30d' | 'all';

export type CaptureResultsMessage = {
  type: 'RELATA_CAPTURE_RESULTS';
  payload: CaptureResult[];
};
