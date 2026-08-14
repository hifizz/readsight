import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { captures, projectSources, projects, sources } from '@/db/schema';
import { apiError, notFoundResponse } from '@/lib/http';
import { requireUser } from '@/lib/require-user';

const membershipSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(50),
  linkedViaCaptureId: z.string().uuid().optional().nullable(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;
  const parsed = membershipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_membership', 'Provide a valid Project selection.');
  const { id: sourceId } = await params;

  const projectIds = [...new Set(parsed.data.projectIds)];
  try {
    const result = await db.transaction(async (tx) => {
      const [source] = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.userId, current.user.id)));
      if (!source) return null;

      if (parsed.data.linkedViaCaptureId) {
        const [capture] = await tx
        .select({ id: captures.id })
        .from(captures)
        .where(
          and(
            eq(captures.id, parsed.data.linkedViaCaptureId),
            eq(captures.sourceId, sourceId),
            eq(captures.userId, current.user.id),
          ),
        );
        if (!capture) throw new Error('invalid_capture');
      }

      if (projectIds.length > 0) {
        const selected = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.userId, current.user.id),
            isNull(projects.archivedAt),
            inArray(projects.id, projectIds),
          ),
        );
        if (selected.length !== projectIds.length) throw new Error('invalid_project');
      }

      await tx
      .delete(projectSources)
      .where(and(eq(projectSources.sourceId, sourceId), eq(projectSources.userId, current.user.id)));
      if (projectIds.length > 0) {
        await tx.insert(projectSources).values(
        projectIds.map((projectId) => ({
          userId: current.user.id,
          projectId,
          sourceId,
          linkedViaCaptureId: parsed.data.linkedViaCaptureId ?? null,
        })),
      );
      }
      return projectIds;
    });

    if (!result) return notFoundResponse();
    return Response.json({ sourceId, projectIds: result });
  } catch (error) {
    if (error instanceof Error && (error.message === 'invalid_project' || error.message === 'invalid_capture')) {
      return apiError(400, error.message, 'The requested relationship is unavailable.');
    }
    throw error;
  }
}
