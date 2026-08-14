/**
 * URL identity policy. Altering this version is a product migration because it changes
 * which captures are deduplicated into one Source.
 */
export const CANONICAL_URL_VERSION = 'v1';

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

export type CanonicalUrl = {
  canonicalUrl: string;
  normalizationVersion: typeof CANONICAL_URL_VERSION;
};

export function canonicalizeUrl(value: string): CanonicalUrl {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('unsupported_url_scheme');
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  const keptParameters = [...url.searchParams.entries()]
    .filter(([name]) => {
      const normalizedName = name.toLowerCase();
      return !normalizedName.startsWith('utm_') && !TRACKING_PARAMETERS.has(normalizedName);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = leftName.localeCompare(rightName);
      return nameOrder || leftValue.localeCompare(rightValue);
    });
  url.search = '';
  for (const [name, parameterValue] of keptParameters) {
    url.searchParams.append(name, parameterValue);
  }

  return { canonicalUrl: url.toString(), normalizationVersion: CANONICAL_URL_VERSION };
}
