import { z } from 'zod';

export const sourceSaveInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(200),
    url: z.string().trim().min(1).max(8_000),
    title: z.string().trim().max(1_000).optional(),
    faviconUrl: z.string().url().max(8_000).optional().nullable(),
    memo: z.string().max(4_000).optional().nullable(),
    projectIds: z.array(z.string().uuid()).max(50).optional(),
    addProjectIds: z.array(z.string().uuid()).max(50).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (input) =>
      input.projectIds === undefined || input.addProjectIds === undefined,
    { message: 'projectIds and addProjectIds are mutually exclusive' },
  );

export type SourceSaveInput = z.infer<typeof sourceSaveInputSchema>;

export function normalizeProjectUpdate(input: SourceSaveInput) {
  return {
    projectIds:
      input.projectIds === undefined
        ? undefined
        : [...new Set(input.projectIds)],
    addProjectIds:
      input.addProjectIds === undefined
        ? undefined
        : [...new Set(input.addProjectIds)],
  };
}
