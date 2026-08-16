import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projectSources, projects, sources } from '@/db/schema';
import { apiError, notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';
import {
  normalizeProjectUpdate,
  sourceSaveInputSchema,
  type SourceSaveInput,
} from '@/lib/source-save-contract';
import { sourceUrlKey } from '@/lib/urls';

const saveRequestSchema = z.object({ items: z.array(z.unknown()).min(1).max(50) });

async function saveOne(userId: string, input: SourceSaveInput) {
  const urlKey = sourceUrlKey(input.url);
  const { projectIds, addProjectIds } = normalizeProjectUpdate(input);
  const memo = input.memo === null ? null : input.memo?.trim() || undefined;
  const title = input.title?.trim() || new URL(urlKey).hostname;
  return db.transaction(async (tx) => {
    const requestedProjectIds = projectIds ?? addProjectIds;
    if (requestedProjectIds?.length) {
      const owned = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), isNull(projects.archivedAt), inArray(projects.id, requestedProjectIds)));
      if (owned.length !== requestedProjectIds.length) throw new Error('invalid_project');
    }
    const now = new Date();
    const insertValues = { id: crypto.randomUUID(), userId, urlKey, originalUrl: urlKey, title, faviconUrl: input.faviconUrl ?? null, sourceType: 'web', metadata: input.metadata ?? {}, memo: memo ?? null, addedAt: now, createdAt: now, updatedAt: now };
    const updateValues: Partial<typeof insertValues> = { originalUrl: urlKey, title, faviconUrl: input.faviconUrl ?? null, metadata: input.metadata ?? {}, updatedAt: now };
    if (memo !== undefined || input.memo === null) updateValues.memo = memo ?? null;
    const [source] = await tx.insert(sources).values(insertValues).onConflictDoUpdate({ target: [sources.userId, sources.urlKey], set: updateValues }).returning();
    if (projectIds !== undefined) {
      await tx.delete(projectSources).where(and(eq(projectSources.userId, userId), eq(projectSources.sourceId, source.id)));
      if (projectIds.length) await tx.insert(projectSources).values(projectIds.map((projectId) => ({ userId, projectId, sourceId: source.id, linkedAt: now })));
    }
    if (addProjectIds?.length) {
      await tx.insert(projectSources).values(addProjectIds.map((projectId) => ({ userId, projectId, sourceId: source.id, linkedAt: now }))).onConflictDoNothing();
    }
    const memberships = (await tx.select({ projectId: projectSources.projectId }).from(projectSources).where(and(eq(projectSources.userId, userId), eq(projectSources.sourceId, source.id)))).map((row) => row.projectId);
    return { ok: true as const, clientRequestId: input.clientRequestId, source, projectIds: memberships };
  });
}

export async function POST(request: Request) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const body = saveRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_source_save_request', 'Provide between 1 and 50 source items.');
  const results = [];
  for (const item of body.data.items) {
    const parsed = sourceSaveInputSchema.safeParse(item);
    const clientRequestId = typeof item === 'object' && item && 'clientRequestId' in item && typeof item.clientRequestId === 'string' ? item.clientRequestId : null;
    if (!parsed.success) { results.push({ ok: false, clientRequestId, error: 'invalid_source', message: 'This tab does not have valid source metadata.' }); continue; }
    try { results.push(await saveOne(current.user.id, parsed.data)); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'source_save_failed';
      results.push({ ok: false, clientRequestId, error: code, message: code === 'invalid_project' ? 'One or more selected Projects are unavailable.' : code === 'invalid_url' || code === 'unsupported_url_scheme' ? 'Only valid http and https URLs can be saved.' : 'This tab could not be saved.' });
    }
  }
  return Response.json({ results });
}

export async function GET(request: Request) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const url = new URL(request.url), inbox = url.searchParams.get('inbox') === 'true', projectId = url.searchParams.get('projectId');
  const from = parseTimeBoundary(url.searchParams.get('from')), to = parseTimeBoundary(url.searchParams.get('to'));
  if (from === false || to === false || (from && to && from >= to)) return apiError(400, 'invalid_time_range', 'Provide a valid [from, to) time range.');
  if (inbox && projectId) return apiError(400, 'invalid_filter', 'Choose Inbox or one Project.');
  if (projectId) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, current.user.id), isNull(projects.archivedAt)));
    if (!project) return notFoundResponse();
  }
  const [sourceRows, memberships] = await Promise.all([
    db.select().from(sources).where(and(eq(sources.userId, current.user.id), from ? gte(sources.addedAt, from) : undefined, to ? lt(sources.addedAt, to) : undefined)).orderBy(desc(sources.addedAt)),
    db.select({ sourceId: projectSources.sourceId, id: projects.id, name: projects.name }).from(projectSources).innerJoin(projects, eq(projectSources.projectId, projects.id)).where(and(eq(projectSources.userId, current.user.id), isNull(projects.archivedAt))),
  ]);
  const bySource = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of memberships) bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), { id: row.id, name: row.name }]);
  const states = sourceRows.map((source) => ({ ...source, projects: bySource.get(source.id) ?? [], projectIds: (bySource.get(source.id) ?? []).map((p) => p.id) })).filter((source) => inbox ? source.projectIds.length === 0 : projectId ? source.projectIds.includes(projectId) : true);
  return Response.json({ sources: states });
}

function parseTimeBoundary(value: string | null): Date | null | false { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? false : parsed; }
