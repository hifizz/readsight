import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { captures, intents } from '@/db/schema';
import { apiError, notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const intentSchema = z.object({ rawText: z.string().trim().max(4_000).optional().default('') });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const parsed = intentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_intent', 'Intent text is too long.');
  const { id: captureId } = await params;

  const [capture] = await db
    .select({ id: captures.id })
    .from(captures)
    .where(and(eq(captures.id, captureId), eq(captures.userId, current.user.id)));
  if (!capture) return notFoundResponse();

  const rawText = parsed.data.rawText.trim();
  if (!rawText) {
    await db.delete(intents).where(and(eq(intents.captureId, captureId), eq(intents.userId, current.user.id)));
    return Response.json({ intent: null });
  }

  const [intent] = await db
    .insert(intents)
    .values({ id: crypto.randomUUID(), userId: current.user.id, captureId, rawText })
    .onConflictDoUpdate({ target: intents.captureId, set: { rawText, updatedAt: new Date() } })
    .returning();
  return Response.json({ intent });
}
