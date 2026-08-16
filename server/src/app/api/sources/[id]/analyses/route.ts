import { createHash } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { analysisRuns, sourceAnalyses, sources } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';
import { ANALYSIS_PROMPT_VERSION, generateSourceAnalysis, RELATA_MODEL_ID } from '@/lib/relata-ai';
import { requireUser } from '@/lib/require-user';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  pageText: z.string().max(120_000).optional(),
  extraction: z.object({ method: z.string().max(80), contentLength: z.number().int().nonnegative().optional() }).optional(),
  simulateFailure: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 50);
  const cursor = Math.min(Number(url.searchParams.get('beforeVersion') ?? 2_147_483_647), 2_147_483_647);
  const [source] = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, id), eq(sources.userId, current.user.id)));
  if (!source) return notFoundResponse();
  const [analyses, runs] = await Promise.all([
    db.select().from(sourceAnalyses).where(and(eq(sourceAnalyses.userId, current.user.id), eq(sourceAnalyses.sourceId, id), lt(sourceAnalyses.version, cursor))).orderBy(desc(sourceAnalyses.version)).limit(limit),
    db.select().from(analysisRuns).where(and(eq(analysisRuns.userId, current.user.id), eq(analysisRuns.sourceId, id))).orderBy(desc(analysisRuns.createdAt)).limit(20),
  ]);
  return Response.json({ analyses, runs, nextCursor: analyses.length === limit ? analyses.at(-1)?.version : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const { id } = await params;
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: 'invalid_analysis_request' }, { status: 400 });

  const [source] = await db.select().from(sources).where(and(eq(sources.id, id), eq(sources.userId, current.user.id)));
  if (!source) return notFoundResponse();
  const fingerprint = createHash('sha256').update(JSON.stringify({ source: source.urlKey, title: source.title, memo: source.memo, pageText: body.data.pageText ?? '' })).digest('hex');
  const runId = crypto.randomUUID();
  await db.insert(analysisRuns).values({
    id: runId, userId: current.user.id, sourceId: id,
    status: 'queued', model: RELATA_MODEL_ID, promptVersion: ANALYSIS_PROMPT_VERSION,
    inputFingerprint: fingerprint,
    extractionMetadata: { method: body.data.extraction?.method ?? (body.data.pageText ? 'extension_text' : 'metadata_only'), contentLength: body.data.pageText?.length ?? 0 },
  });

  const quota = await reserveUsage(current.user.id, 'analysis_requests');
  if (!quota.allowed) {
    await db.update(analysisRuns).set({ status: 'failed', errorCode: 'daily_quota_exceeded', completedAt: new Date() }).where(eq(analysisRuns.id, runId));
    return quotaExceededResponse(quota);
  }
  await db.update(analysisRuns).set({ status: 'running', startedAt: new Date() }).where(eq(analysisRuns.id, runId));

  try {
    if (body.data.simulateFailure && process.env.NODE_ENV !== 'production') throw new Error('simulated_failure');
    const output = await generateSourceAnalysis({ title: source.title, url: source.originalUrl, pageText: body.data.pageText, memo: source.memo });
    const analysis = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
      const [latest] = await tx.select({ version: sourceAnalyses.version }).from(sourceAnalyses).where(eq(sourceAnalyses.sourceId, id)).orderBy(desc(sourceAnalyses.version)).limit(1);
      const [created] = await tx.insert(sourceAnalyses).values({
        id: crypto.randomUUID(), userId: current.user.id, sourceId: id, analysisRunId: runId,
        version: (latest?.version ?? 0) + 1, ...output, model: RELATA_MODEL_ID, promptVersion: ANALYSIS_PROMPT_VERSION,
      }).returning();
      await tx.update(analysisRuns).set({ status: 'completed', completedAt: new Date() }).where(eq(analysisRuns.id, runId));
      return created;
    });
    return Response.json({ analysis, runId }, { status: 201 });
  } catch (error) {
    const errorCode = error instanceof Error && error.message === 'model_not_configured' ? 'model_not_configured' : 'analysis_failed';
    await db.update(analysisRuns).set({ status: 'failed', errorCode, completedAt: new Date() }).where(eq(analysisRuns.id, runId));
    return Response.json({ error: errorCode, runId, message: 'Analysis could not be completed. Earlier versions remain available.' }, { status: errorCode === 'model_not_configured' ? 503 : 502 });
  }
}
