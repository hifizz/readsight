import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { projectSources, projects, sources } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

export async function GET(request: Request) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;

  const url = new URL(request.url);
  const inbox = url.searchParams.get('inbox') === 'true';
  const projectId = url.searchParams.get('projectId');
  if (inbox && projectId) {
    return Response.json({ error: 'invalid_filter', message: 'Choose Inbox or one Project.' }, { status: 400 });
  }

  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, current.user.id), isNull(projects.archivedAt)));
    if (!project) return notFoundResponse();
  }

  const [sourceRows, memberships] = await Promise.all([
    db.select().from(sources).where(eq(sources.userId, current.user.id)).orderBy(desc(sources.lastCapturedAt)),
    db
      .select({ sourceId: projectSources.sourceId, projectId: projectSources.projectId })
      .from(projectSources)
      .innerJoin(projects, eq(projectSources.projectId, projects.id))
      .where(and(eq(projectSources.userId, current.user.id), isNull(projects.archivedAt))),
  ]);

  const projectIdsBySource = new Map<string, string[]>();
  for (const membership of memberships) {
    projectIdsBySource.set(membership.sourceId, [
      ...(projectIdsBySource.get(membership.sourceId) ?? []),
      membership.projectId,
    ]);
  }

  const sourceStates = sourceRows
    .map((source) => ({ ...source, projectIds: projectIdsBySource.get(source.id) ?? [] }))
    .filter((source) => {
      if (inbox) return source.projectIds.length === 0;
      return projectId ? source.projectIds.includes(projectId) : true;
    });
  return Response.json({ sources: sourceStates });
}
