import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projectSources, projects, sources } from '@/db/schema';
import { apiError, notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const patchSchema = z.object({ memo: z.string().max(4_000).nullable().optional(), pinned: z.boolean().optional() }).refine((v) => v.memo !== undefined || v.pinned !== undefined);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const { id } = await params;
  const [source] = await db.select().from(sources).where(and(eq(sources.id, id), eq(sources.userId, current.user.id)));
  if (!source) return notFoundResponse();
  const memberships = await db.select({ id: projects.id, name: projects.name }).from(projectSources).innerJoin(projects, eq(projectSources.projectId, projects.id)).where(and(eq(projectSources.sourceId, id), eq(projectSources.userId, current.user.id)));
  return Response.json({ source: { ...source, projects: memberships, projectIds: memberships.map((p) => p.id) } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_source_update', 'Provide a valid Memo or pinned state.');
  const { id } = await params;
  const values: { memo?: string | null; pinnedAt?: Date | null; updatedAt: Date } = { updatedAt: new Date() };
  if (parsed.data.memo !== undefined) values.memo = parsed.data.memo === null ? null : parsed.data.memo.trim() || null;
  if (parsed.data.pinned !== undefined) values.pinnedAt = parsed.data.pinned ? new Date() : null;
  const [source] = await db.update(sources).set(values).where(and(eq(sources.id, id), eq(sources.userId, current.user.id))).returning();
  if (!source) return notFoundResponse();
  return Response.json({ source });
}
