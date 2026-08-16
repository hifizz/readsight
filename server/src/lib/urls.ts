/** Validate a Chrome-provided URL without changing its identity. */
export function sourceUrlKey(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('invalid_url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported_url_scheme');
  return value.trim();
}
