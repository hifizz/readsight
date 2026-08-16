import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { BACKEND } from '@/lib/source-saving';
import type { InboxRange, Project, Source } from './types';
import { useLibraryStore } from './library-store';

export function useLibraryData() {
  const projects = useLibraryStore((state) => state.projects);
  const sources = useLibraryStore((state) => state.sources);
  const loading = useLibraryStore((state) => state.loading);
  const error = useLibraryStore((state) => state.error);
  const beginLoad = useLibraryStore((state) => state.beginLoad);
  const setSnapshot = useLibraryStore((state) => state.setSnapshot);
  const setStoreError = useLibraryStore((state) => state.setError);
  const patchSource = useLibraryStore((state) => state.patchSource);
  const replaceMemberships = useLibraryStore((state) => state.replaceMemberships);
  const applySaveResults = useLibraryStore((state) => state.applySaveResults);
  const addProject = useLibraryStore((state) => state.addProject);
  const updateProject = useLibraryStore((state) => state.updateProject);
  const removeProject = useLibraryStore((state) => state.removeProject);
  const removeSource = useLibraryStore((state) => state.removeSource);
  const reset = useLibraryStore((state) => state.reset);
  const [inboxRange, setInboxRange] = useState<InboxRange>('today');

  const refreshBase = useCallback(async () => {
    beginLoad();
    try {
      const [projectResponse, sourceResponse] = await Promise.all([
        authFetch(`${BACKEND}/api/projects`),
        authFetch(`${BACKEND}/api/sources`),
      ]);
      if (!projectResponse.ok || !sourceResponse.ok) throw new Error('无法加载保存内容。');
      const [projectBody, sourceBody] = await Promise.all([
        projectResponse.json() as Promise<{ projects: Project[] }>,
        sourceResponse.json() as Promise<{ sources: Source[] }>,
      ]);
      setSnapshot(projectBody.projects, sourceBody.sources);
    } catch (caught) {
      setStoreError(caught instanceof Error ? caught.message : '无法加载保存内容。');
    }
  }, [beginLoad, setSnapshot, setStoreError]);

  useEffect(() => { void refreshBase(); }, [refreshBase]);

  const inboxSources = useMemo(() => {
    const start = rangeStart(inboxRange);
    return sources.filter((source) => source.projectIds.length === 0 && (!start || Date.parse(source.addedAt) >= start));
  }, [inboxRange, sources]);
  const sourcesByProject = useMemo(() => new Map(projects.map((project) => [project.id, sources.filter((source) => source.projectIds.includes(project.id))])), [projects, sources]);
  const pinnedSources = useMemo(() => sources.filter((source) => source.pinnedAt).sort((a, b) => Date.parse(b.pinnedAt!) - Date.parse(a.pinnedAt!)), [sources]);

  return {
    projects, inboxSources, inboxRange, setInboxRange, inboxLoading: loading, loading, error,
    sourcesByProject, pinnedSources, refreshBase, patchSource, replaceMemberships,
    applySaveResults, addProject, updateProject, removeProject, removeSource, reset,
  };
}

function rangeStart(range: InboxRange): number | null {
  if (range === 'all') return null;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (range === '7d') from.setDate(from.getDate() - 6);
  if (range === '30d') from.setDate(from.getDate() - 29);
  return from.getTime();
}
