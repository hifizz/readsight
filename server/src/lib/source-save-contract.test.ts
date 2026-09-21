import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProjectUpdate,
  sourceSaveInputSchema,
} from './source-save-contract';

const projectA = '00000000-0000-4000-8000-000000000001';
const projectB = '00000000-0000-4000-8000-000000000002';

test('accepts additive Project membership updates and removes duplicate ids', () => {
  const input = sourceSaveInputSchema.parse({
    clientRequestId: 'request-1',
    url: 'https://example.com',
    addProjectIds: [projectA, projectA, projectB],
  });

  assert.deepEqual(normalizeProjectUpdate(input), {
    projectIds: undefined,
    addProjectIds: [projectA, projectB],
  });
});

test('rejects replacement and additive Project updates in the same save', () => {
  const result = sourceSaveInputSchema.safeParse({
    clientRequestId: 'request-2',
    url: 'https://example.com',
    projectIds: [projectA],
    addProjectIds: [projectB],
  });

  assert.equal(result.success, false);
});
