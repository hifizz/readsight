import type { InboxRange } from './types';

export function domainFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function canonicalForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

export function initials(value: string): string {
  return (
    value
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'R'
  );
}

export function relativeTime(value: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1_000)
  );
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

export function isCaptureResultMessage(
  value: unknown
): value is import('./types').CaptureResultsMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'RELATA_CAPTURE_RESULTS' &&
    'payload' in value &&
    Array.isArray(value.payload)
  );
}
