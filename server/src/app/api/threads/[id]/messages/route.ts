import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { messages, projectInsights, projects, sourceAnalyses, sources, threads } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';
import { generateConversationReply, RELATA_MODEL_ID } from '@/lib/relata-ai';
import { requireUser } from '@/lib/require-user';

export const maxDuration = 60;
const contentSchema = z.array(z.object({ type: z.string().min(1).max(80) }).passthrough()).min(1).max(50);
const postSchema = z.object({ content: contentSchema, sourceAnalysisId: z.string().uuid().optional(), projectInsightId: z.string().uuid().optional() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response; const { id } = await params;
  const [thread] = await db.select({ id: threads.id }).from(threads).where(and(eq(threads.id, id), eq(threads.userId, current.user.id))); if (!thread) return notFoundResponse();
  return Response.json({ messages: await db.select().from(messages).where(and(eq(messages.threadId, id), eq(messages.userId, current.user.id))).orderBy(asc(messages.createdAt)) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response; const { id } = await params;
  const parsed = postSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: 'invalid_message' }, { status: 400 });
  const [thread] = await db.select().from(threads).where(and(eq(threads.id, id), eq(threads.userId, current.user.id))); if (!thread) return notFoundResponse();
  const [analysis] = parsed.data.sourceAnalysisId
    ? await db.select().from(sourceAnalyses).where(and(eq(sourceAnalyses.id, parsed.data.sourceAnalysisId), eq(sourceAnalyses.userId, current.user.id), thread.sourceId ? eq(sourceAnalyses.sourceId, thread.sourceId) : undefined))
    : thread.sourceId ? await db.select().from(sourceAnalyses).where(and(eq(sourceAnalyses.userId, current.user.id), eq(sourceAnalyses.sourceId, thread.sourceId))).orderBy(desc(sourceAnalyses.version)).limit(1) : [];
  const [insight] = parsed.data.projectInsightId
    ? await db.select().from(projectInsights).where(and(eq(projectInsights.id, parsed.data.projectInsightId), eq(projectInsights.userId, current.user.id)))
    : thread.projectId && thread.sourceId ? await db.select().from(projectInsights).where(and(eq(projectInsights.userId, current.user.id), eq(projectInsights.projectId, thread.projectId), eq(projectInsights.sourceId, thread.sourceId))).orderBy(desc(projectInsights.version)).limit(1) : [];
  if (parsed.data.sourceAnalysisId && !analysis) return notFoundResponse(); if (parsed.data.projectInsightId && !insight) return notFoundResponse();
  const quota = await reserveUsage(current.user.id, 'conversation_requests'); if (!quota.allowed) return quotaExceededResponse(quota);
  const [userMessage] = await db.insert(messages).values({ id: crypto.randomUUID(), userId: current.user.id, threadId: id, role: 'user', content: parsed.data.content, sourceAnalysisId: analysis?.id, projectInsightId: insight?.id }).returning();
  const history = await db.select({ role: messages.role, content: messages.content }).from(messages).where(and(eq(messages.userId, current.user.id), eq(messages.threadId, id))).orderBy(asc(messages.createdAt));
  const [[source], [project]] = await Promise.all([
    thread.sourceId ? db.select({ title: sources.title, url: sources.originalUrl }).from(sources).where(and(eq(sources.id, thread.sourceId), eq(sources.userId, current.user.id))) : Promise.resolve([]),
    thread.projectId ? db.select({ name: projects.name, description: projects.description }).from(projects).where(and(eq(projects.id, thread.projectId), eq(projects.userId, current.user.id))) : Promise.resolve([]),
  ]);
  try {
    const reply = await generateConversationReply({ source, project, analysis, insight }, history);
    const [assistantMessage] = await db.insert(messages).values({ id: crypto.randomUUID(), userId: current.user.id, threadId: id, role: 'assistant', content: [{ type: 'text', text: reply }], sourceAnalysisId: analysis?.id, projectInsightId: insight?.id, model: RELATA_MODEL_ID }).returning();
    await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, id));
    return Response.json({ userMessage, assistantMessage }, { status: 201 });
  } catch {
    return Response.json({ error: 'conversation_failed', message: 'The message was saved, but Relata could not reply.' }, { status: 502 });
  }
}
