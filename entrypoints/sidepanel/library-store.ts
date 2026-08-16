import { create } from 'zustand';
import type { SourceSaveResult } from '@/lib/source-saving';
import type { Project, Source } from './types';

type SourcePatch = Partial<Source> & Pick<Source, 'id'>;

type LibraryStore = {
  projects: Project[];
  sources: Source[];
  initialized: boolean;
  loading: boolean;
  error: string | null;
  beginLoad: () => void;
  setSnapshot: (projects: Project[], sources: Source[]) => void;
  setError: (error: string) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  patchSource: (source: SourcePatch) => void;
  removeSource: (sourceId: string) => void;
  replaceMemberships: (sourceId: string, projectIds: string[]) => void;
  applySaveResults: (results: SourceSaveResult[]) => void;
  reset: () => void;
};

function projectMetadata(projects: Project[], ids: string[]) {
  const selected = new Set(ids);
  return projects
    .filter((project) => selected.has(project.id))
    .map(({ id, name }) => ({ id, name }));
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  projects: [],
  sources: [],
  initialized: false,
  loading: true,
  error: null,
  beginLoad: () =>
    set((state) => ({ loading: !state.initialized, error: null })),
  setSnapshot: (projects, sources) =>
    set({ projects, sources, initialized: true, loading: false, error: null }),
  setError: (error) =>
    set((state) => ({
      error,
      loading: state.initialized ? false : state.loading
    })),
  addProject: (project) =>
    set((state) => ({
      projects: [
        project,
        ...state.projects.filter((item) => item.id !== project.id)
      ]
    })),
  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((item) =>
        item.id === project.id ? project : item
      ),
      sources: state.sources.map((source) =>
        source.projectIds.includes(project.id)
          ? {
              ...source,
              projects: source.projects.map((item) =>
                item.id === project.id
                  ? { id: project.id, name: project.name }
                  : item
              )
            }
          : source
      )
    })),
  removeProject: (projectId) =>
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== projectId),
      sources: state.sources.map((source) => ({
        ...source,
        projectIds: source.projectIds.filter((id) => id !== projectId),
        projects: source.projects.filter((project) => project.id !== projectId)
      }))
    })),
  patchSource: (updated) =>
    set((state) => ({
      sources: state.sources.map((source) =>
        source.id === updated.id ? { ...source, ...updated } : source
      )
    })),
  removeSource: (sourceId) =>
    set((state) => ({
      sources: state.sources.filter((source) => source.id !== sourceId)
    })),
  replaceMemberships: (sourceId, projectIds) =>
    set((state) => ({
      sources: state.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              projectIds,
              projects: projectMetadata(state.projects, projectIds)
            }
          : source
      )
    })),
  applySaveResults: (results) =>
    set((state) => {
      const next = new Map(state.sources.map((source) => [source.id, source]));
      for (const result of results) {
        if (!result.ok) continue;
        const previous = next.get(result.source.id);
        next.set(result.source.id, {
          ...previous,
          ...result.source,
          projectIds: result.projectIds,
          projects: projectMetadata(state.projects, result.projectIds)
        });
      }
      return {
        sources: [...next.values()].sort(
          (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)
        )
      };
    }),
  reset: () =>
    set({
      projects: [],
      sources: [],
      initialized: false,
      loading: true,
      error: null
    })
}));
