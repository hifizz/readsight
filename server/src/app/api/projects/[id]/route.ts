import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { apiError, notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  archived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'No project changes supplied.');

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const parsed = updateProjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_project', 'Provide a valid project update.');

  const { id } = await params;
  const now = new Date();
  const [project] = await db
    .update(projects)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? now : null } : {}),
      updatedAt: now,
    })
    .where(and(eq(projects.id, id), eq(projects.userId, current.user.id)))
    .returning();
  if (!project) return notFoundResponse();
  return Response.json({ project });
}
