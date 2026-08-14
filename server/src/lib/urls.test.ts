import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_URL_VERSION, canonicalizeUrl } from './urls';

test('规范化主机、fragment、tracking parameters 和查询参数顺序', () => {
  const result = canonicalizeUrl(
    ' HTTPS://Example.COM/path?utm_source=x&b=2&a=3&fbclid=ignored&a=1#section ',
  );

  assert.deepEqual(result, {
    canonicalUrl: 'https://example.com/path?a=1&a=3&b=2',
    normalizationVersion: CANONICAL_URL_VERSION,
  });
});

test('保留非 tracking parameters 并移除大小写不同的 tracking parameters', () => {
  assert.equal(
    canonicalizeUrl('http://example.com/?UTM_Campaign=x&ref=relata&gClId=y').canonicalUrl,
    'http://example.com/?ref=relata',
  );
});

test('拒绝无效 URL 和非 HTTP(S) scheme', () => {
  assert.throws(() => canonicalizeUrl('not a URL'), /invalid_url/);
  assert.throws(() => canonicalizeUrl('chrome://extensions'), /unsupported_url_scheme/);
});
