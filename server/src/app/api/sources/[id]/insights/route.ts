import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projectInsights, projects, projectSources, sourceAnalyses, sources } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';
import { generateProjectInsight, INSIGHT_PROMPT_VERSION, RELATA_MODEL_ID } from '@/lib/relata-ai';
import { requireUser } from '@/lib/require-user';

export const maxDuration = 60;
const postSchema = z.object({ projectId: z.string().uuid(), sourceAnalysisId: z.string().uuid().optional() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const { id } = await params; const url = new URL(request.url); const projectId = url.searchParams.get('projectId');
  if (!projectId) return Response.json({ error: 'project_id_required' }, { status: 400 });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 50);
  const cursor = Math.min(Number(url.searchParams.get('beforeVersion') ?? 2_147_483_647), 2_147_483_647);
  const rows = await db.select().from(projectInsights).where(and(eq(projectInsights.userId, current.user.id), eq(projectInsights.sourceId, id), eq(projectInsights.projectId, projectId), lt(projectInsights.version, cursor))).orderBy(desc(projectInsights.version)).limit(limit);
  return Response.json({ insights: rows, nextCursor: rows.length === limit ? rows.at(-1)?.version : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const { id } = await params; const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_insight_request' }, { status: 400 });
  const [[source], [project], [membership]] = await Promise.all([
    db.select().from(sources).where(and(eq(sources.id, id), eq(sources.userId, current.user.id))),
    db.select().from(projects).where(and(eq(projects.id, parsed.data.projectId), eq(projects.userId, current.user.id))),
    db.select().from(projectSources).where(and(eq(projectSources.sourceId, id), eq(projectSources.projectId, parsed.data.projectId), eq(projectSources.userId, current.user.id))),
  ]);
  if (!source || !project || !membership) return notFoundResponse();
  const [analysis] = parsed.data.sourceAnalysisId
    ? await db.select().from(sourceAnalyses).where(and(eq(sourceAnalyses.id, parsed.data.sourceAnalysisId), eq(sourceAnalyses.sourceId, id), eq(sourceAnalyses.userId, current.user.id)))
    : await db.select().from(sourceAnalyses).where(and(eq(sourceAnalyses.sourceId, id), eq(sourceAnalyses.userId, current.user.id))).orderBy(desc(sourceAnalyses.version)).limit(1);
  if (!analysis) return Response.json({ error: 'analysis_required', message: 'Analyze the Source first.' }, { status: 409 });
  const quota = await reserveUsage(current.user.id, 'analysis_requests'); if (!quota.allowed) return quotaExceededResponse(quota);
  try {
    const output = await generateProjectInsight({ project: { name: project.name, description: project.description }, source: { title: source.title, url: source.originalUrl }, analysis: { summary: analysis.summary, keyPoints: analysis.keyPoints } });
    const insight = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${parsed.data.projectId}:${id}`}))`);
      const [latest] = await tx.select({ version: projectInsights.version }).from(projectInsights).where(and(eq(projectInsights.projectId, parsed.data.projectId), eq(projectInsights.sourceId, id))).orderBy(desc(projectInsights.version)).limit(1);
      const [created] = await tx.insert(projectInsights).values({ id: crypto.randomUUID(), userId: current.user.id, projectId: parsed.data.projectId, sourceId: id, sourceAnalysisId: analysis.id, version: (latest?.version ?? 0) + 1, ...output, model: RELATA_MODEL_ID, promptVersion: INSIGHT_PROMPT_VERSION }).returning();
      return created;
    });
    return Response.json({ insight }, { status: 201 });
  } catch {
    return Response.json({ error: 'insight_failed', message: 'Project insight could not be completed.' }, { status: 502 });
  }
}
