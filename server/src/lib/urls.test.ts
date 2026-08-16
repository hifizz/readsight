import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceUrlKey } from './urls';

test('preserves query order, duplicate parameters, tracking and fragments', () => {
  const values = ['https://example.com/article', 'https://example.com/article?utm_source=x&a=2&a=1', 'https://example.com/article#comments', 'https://example.com/search?q=react', 'https://example.com/search?q=vue'];
  assert.deepEqual(values.map(sourceUrlKey), values);
  assert.equal(new Set(values.map(sourceUrlKey)).size, values.length);
});

test('respects the Chrome serialization boundary', () => {
  assert.equal(new URL('https://EXAMPLE.com:443/article').toString(), 'https://example.com/article');
  assert.equal(sourceUrlKey('https://example.com/article'), 'https://example.com/article');
});

test('rejects unsupported schemes', () => assert.throws(() => sourceUrlKey('chrome://settings'), /unsupported_url_scheme/));
