import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { captures, intents, projectSources, projects, sources } from '@/db/schema';
import { apiError } from '@/lib/http';
import { requireUser } from '@/lib/require-user';
import { canonicalizeUrl } from '@/lib/urls';

const captureInputSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(8_000),
  title: z.string().trim().max(1_000).optional(),
  faviconUrl: z.string().url().max(8_000).optional().nullable(),
  captureMethod: z.enum(['side_panel', 'tab_context_menu', 'toolbar']).default('side_panel'),
  intent: z.string().trim().max(4_000).optional(),
  projectIds: z.array(z.string().uuid()).max(50).default([]),
  selection: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const captureRequestSchema = z.object({
  items: z.array(z.unknown()).min(1).max(50),
});

type CaptureInput = z.infer<typeof captureInputSchema>;

type CaptureSuccess = {
  ok: true;
  clientRequestId: string;
  idempotent: boolean;
  source: typeof sources.$inferSelect;
  capture: typeof captures.$inferSelect;
  intent: typeof intents.$inferSelect | null;
  projectIds: string[];
};

type CaptureFailure = {
  ok: false;
  clientRequestId: string | null;
  error: string;
  message: string;
};

function failure(input: unknown, error: string, message: string): CaptureFailure {
  const clientRequestId = typeof input === 'object' && input && 'clientRequestId' in input
    && typeof input.clientRequestId === 'string'
    ? input.clientRequestId
    : null;
  return { ok: false, clientRequestId, error, message };
}

async function existingCaptureResult(userId: string, clientRequestId: string): Promise<CaptureSuccess | null> {
  const [capture] = await db
    .select()
    .from(captures)
    .where(and(eq(captures.userId, userId), eq(captures.clientRequestId, clientRequestId)));
  if (!capture) return null;

  const [[source], [intent], memberships] = await Promise.all([
    db.select().from(sources).where(and(eq(sources.id, capture.sourceId), eq(sources.userId, userId))),
    db.select().from(intents).where(and(eq(intents.captureId, capture.id), eq(intents.userId, userId))),
    db.select({ projectId: projectSources.projectId })
      .from(projectSources)
      .where(and(eq(projectSources.sourceId, capture.sourceId), eq(projectSources.userId, userId))),
  ]);
  if (!source) throw new Error('capture_source_missing');
  return {
    ok: true,
    clientRequestId,
    idempotent: true,
    source,
    capture,
    intent: intent ?? null,
    projectIds: memberships.map((membership) => membership.projectId),
  };
}

async function captureOne(userId: string, input: CaptureInput): Promise<CaptureSuccess> {
  const previous = await existingCaptureResult(userId, input.clientRequestId);
  if (previous) return previous;

  const normalized = canonicalizeUrl(input.url);
  const projectIds = [...new Set(input.projectIds)];
  const capturedTitle = input.title?.trim() || new URL(input.url).hostname;
  const capturedIntent = input.intent?.trim() || null;

  return db.transaction(async (tx) => {
    if (projectIds.length > 0) {
      const selectedProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.userId, userId),
            isNull(projects.archivedAt),
            inArray(projects.id, projectIds),
          ),
        );
      if (selectedProjects.length !== projectIds.length) throw new Error('invalid_project');
    }

    const now = new Date();
    const [source] = await tx
      .insert(sources)
      .values({
        id: crypto.randomUUID(),
        userId,
        canonicalUrl: normalized.canonicalUrl,
        originalUrl: input.url,
        title: capturedTitle,
        faviconUrl: input.faviconUrl || null,
        sourceType: 'web',
        metadata: {
          ...(input.metadata ?? {}),
          normalizationVersion: normalized.normalizationVersion,
        },
        firstCapturedAt: now,
        lastCapturedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sources.userId, sources.canonicalUrl],
        set: {
          originalUrl: input.url,
          title: capturedTitle,
          faviconUrl: input.faviconUrl || null,
          metadata: {
            ...(input.metadata ?? {}),
            normalizationVersion: normalized.normalizationVersion,
          },
          lastCapturedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    const [capture] = await tx
      .insert(captures)
      .values({
        id: crypto.randomUUID(),
        userId,
        sourceId: source.id,
        clientRequestId: input.clientRequestId,
        captureMethod: input.captureMethod,
        capturedUrl: input.url,
        capturedTitle,
        capturedFaviconUrl: input.faviconUrl || null,
        selection: input.selection ?? null,
        capturedAt: now,
      })
      .onConflictDoNothing({ target: [captures.userId, captures.clientRequestId] })
      .returning();
    // A concurrent request with the same client id has already committed. Roll this
    // transaction back, then replay that committed result from the outer handler.
    if (!capture) throw new Error('idempotent_conflict');

    const [intent] = capturedIntent
      ? await tx
        .insert(intents)
        .values({ id: crypto.randomUUID(), userId, captureId: capture.id, rawText: capturedIntent })
        .returning()
      : [];

    if (projectIds.length > 0) {
      await tx
        .insert(projectSources)
        .values(
          projectIds.map((projectId) => ({
            userId,
            projectId,
            sourceId: source.id,
            linkedViaCaptureId: capture.id,
            linkedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [projectSources.projectId, projectSources.sourceId],
          set: { linkedViaCaptureId: capture.id, linkedAt: now },
        });
    }

    return {
      ok: true,
      clientRequestId: input.clientRequestId,
      idempotent: false,
      source,
      capture,
      intent: intent ?? null,
      projectIds,
    };
  });
}

export async function POST(request: Request) {
  const current = await requireUser(request);
  if (!current.ok) return current.response;

  const body = captureRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_capture_request', 'Provide between 1 and 50 capture items.');

  const results: Array<CaptureSuccess | CaptureFailure> = [];
  for (const item of body.data.items) {
    const parsed = captureInputSchema.safeParse(item);
    if (!parsed.success) {
      results.push(failure(item, 'invalid_capture', 'This tab does not have valid capture metadata.'));
      continue;
    }

    try {
      results.push(await captureOne(current.user.id, parsed.data));
    } catch (error) {
      if (
        (error as { code?: string }).code === '23505'
        || (error instanceof Error && error.message === 'idempotent_conflict')
      ) {
        const previous = await existingCaptureResult(current.user.id, parsed.data.clientRequestId);
        if (previous) {
          results.push(previous);
          continue;
        }
      }
      const code = error instanceof Error ? error.message : 'capture_failed';
      if (code === 'invalid_url' || code === 'unsupported_url_scheme') {
        results.push(failure(item, code, 'Only valid http and https URLs can be saved.'));
      } else if (code === 'invalid_project') {
        results.push(failure(item, code, 'One or more selected Projects are unavailable.'));
      } else {
        results.push(failure(item, 'capture_failed', 'This tab could not be saved.'));
      }
    }
  }

  return Response.json({ results });
}
