import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { threads } from '@/db/schema';
import { notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const patchSchema = z.object({ title: z.string().trim().max(200).optional().nullable(), archived: z.boolean().optional() });
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request); if (!current.ok) return current.response;
  const { id } = await params; const parsed = patchSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: 'invalid_thread_update' }, { status: 400 });
  const [thread] = await db.update(threads).set({ ...(parsed.data.title !== undefined ? { title: parsed.data.title || null } : {}), ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}), updatedAt: new Date() }).where(and(eq(threads.id, id), eq(threads.userId, current.user.id))).returning();
  return thread ? Response.json({ thread }) : notFoundResponse();
}
