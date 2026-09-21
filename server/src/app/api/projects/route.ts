import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { apiError } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(32),
  description: z.string().trim().max(2_000).optional().nullable(),
});

export async function GET(request: Request) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;

  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
  const where = includeArchived
    ? eq(projects.userId, current.user.id)
    : and(eq(projects.userId, current.user.id), isNull(projects.archivedAt));
  const rows = await db.select().from(projects).where(where).orderBy(desc(projects.updatedAt));
  return Response.json({ projects: rows });
}

export async function POST(request: Request) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;

  const parsed = createProjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_project', 'Project name is required.');

  const [project] = await db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      userId: current.user.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .returning();
  return Response.json({ project }, { status: 201 });
}
