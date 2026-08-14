import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projects, projectSources, sources, threads } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const createSchema = z.object({ sourceId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), title: z.string().trim().max(200).optional() }).refine((value) => value.sourceId || value.projectId);

export async function GET(request: Request) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const url = new URL(request.url); const sourceId = url.searchParams.get('sourceId'); const projectId = url.searchParams.get('projectId');
  let where = and(eq(threads.userId, current.user.id), isNull(threads.archivedAt));
  if (sourceId) where = and(where, eq(threads.sourceId, sourceId));
  if (projectId) where = and(where, eq(threads.projectId, projectId));
  return Response.json({ threads: await db.select().from(threads).where(where).orderBy(desc(threads.updatedAt)) });
}

export async function POST(request: Request) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: 'invalid_thread' }, { status: 400 });
  const { sourceId, projectId } = parsed.data;
  const [[source], [project], [membership]] = await Promise.all([
    sourceId ? db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, sourceId), eq(sources.userId, current.user.id))) : Promise.resolve([{}]),
    projectId ? db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, current.user.id))) : Promise.resolve([{}]),
    sourceId && projectId ? db.select().from(projectSources).where(and(eq(projectSources.userId, current.user.id), eq(projectSources.sourceId, sourceId), eq(projectSources.projectId, projectId))) : Promise.resolve([{}]),
  ]);
  if ((sourceId && !source) || (projectId && !project) || (sourceId && projectId && !membership)) return notFoundResponse();
  const [thread] = await db.insert(threads).values({ id: crypto.randomUUID(), userId: current.user.id, sourceId, projectId, title: parsed.data.title || null }).returning();
  return Response.json({ thread }, { status: 201 });
}
