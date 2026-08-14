import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { captures, intents, projectSources, projects, sources } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const { id } = await params;

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, current.user.id)));
  if (!source) return notFoundResponse();

  const [captureRows, membershipRows] = await Promise.all([
    db
      .select()
      .from(captures)
      .where(and(eq(captures.sourceId, id), eq(captures.userId, current.user.id)))
      .orderBy(desc(captures.capturedAt)),
    db
      .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
      .from(projectSources)
      .innerJoin(projects, eq(projectSources.projectId, projects.id))
      .where(and(eq(projectSources.sourceId, id), eq(projectSources.userId, current.user.id))),
  ]);
  const captureIds = new Set(captureRows.map((capture) => capture.id));
  const intentRows = captureIds.size === 0
    ? []
    : await db
      .select()
      .from(intents)
      .where(and(eq(intents.userId, current.user.id), inArray(intents.captureId, [...captureIds])))
      .orderBy(desc(intents.updatedAt));
  return Response.json({
    source,
    captures: captureRows,
    intents: intentRows.filter((intent) => captureIds.has(intent.captureId)),
    projects: membershipRows,
  });
}
