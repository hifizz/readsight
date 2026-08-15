import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { BACKEND } from '@/lib/capture';
import type { InboxRange, Project, Source } from './types';
import { inboxRangeQuery } from './utils';

export function useLibraryData() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [inboxSources, setInboxSources] = useState<Source[]>([]);
  const [inboxRange, setInboxRange] = useState<InboxRange>('today');
  const [inboxLoading, setInboxLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResponse, sourceResponse] = await Promise.all([
        authFetch(`${BACKEND}/api/projects`),
        authFetch(`${BACKEND}/api/sources`)
      ]);
      if (!projectResponse.ok || !sourceResponse.ok) {
        throw new Error('无法加载保存内容。');
      }
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

  return {
    projects,
    inboxSources,
    inboxRange,
    setInboxRange,
    inboxLoading,
    loading,
    error,
    sourcesByProject,
    refreshBase,
    refreshAll
  };
}
