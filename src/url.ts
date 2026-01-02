import { URL, URLSearchParams } from 'url';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
]);

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function canonicalizeUrl(input: string): { ok: true; canonicalUrl: string; normalizedUrl: string } | { ok: false; reason: string } {
  const normalizedUrl = normalizeUrlInput(input);

  let url: URL;
  try {
    url = new URL(normalizedUrl);
  } catch {
    return { ok: false, reason: 'URL格式无效' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: '仅支持http/https链接' };
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  const params = new URLSearchParams(url.search);
  for (const key of Array.from(params.keys()) as string[]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      params.delete(key);
    }
  }

  const sortedEntries = Array.from(params.entries()) as Array<[string, string]>;
  sortedEntries.sort((a, b) => {
    const [aKey, aVal] = a;
    const [bKey, bVal] = b;

    const k = aKey.localeCompare(bKey);
    if (k !== 0) return k;
    return aVal.localeCompare(bVal);
  });

  const nextParams = new URLSearchParams();
  for (const [k, v] of sortedEntries) nextParams.append(k, v);
  url.search = nextParams.toString() ? `?${nextParams.toString()}` : '';

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return { ok: true, canonicalUrl: url.toString(), normalizedUrl };
}
