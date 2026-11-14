import { EVENTS_HOST } from './events.ts';
import { FIREBASE } from './firebase.ts';
import { applyRows, validRow, type Row } from './additions.ts';

/**
 * (#360) The phone's copy of the published additions: one Cache Storage cache, `catalog-v1`, holding
 * `{ published, retired }`. Read before the first render; refreshed after it, for the next open, so a plan
 * never changes under the lifter. Offline, a failed download or an odd reply keeps the last good copy;
 * a first visit with none plans from the built-in list. Deploys keep this cache (sw.js deletes only
 * `fitbod-clone-*` caches).
 */
export const CATALOG_CACHE = 'catalog-v1';
const KEY = '/catalog-v1.json';

export interface CatalogCopy {
  published: Row[];
  retired: Row[];
}

const rows = (list: unknown): Row[] => (Array.isArray(list) ? list.flatMap((row) => validRow(row) ?? []) : []);

async function readCopy(): Promise<CatalogCopy | null> {
  try {
    const hit = await (await caches.open(CATALOG_CACHE)).match(KEY);
    const body = hit ? ((await hit.json()) as Partial<CatalogCopy>) : null;
    return body ? { published: rows(body.published), retired: rows(body.retired) } : null;
  } catch {
    return null;
  }
}

/** Before the first render: apply the cached copy. Never throws, never waits more than a second. */
export async function loadCatalog(): Promise<void> {
  const copy = await Promise.race([readCopy(), new Promise<undefined>((done) => setTimeout(done, 1000))]);
  if (copy) applyRows(copy.published, copy.retired);
}

type Value = { stringValue?: string; arrayValue?: { values?: Value[] } };

/** Firestore's typed fields as a plain object. Rows hold only strings and lists of strings. */
export function plain(fields: Record<string, Value> = {}): Record<string, unknown> {
  const one = (value: Value): unknown => (value.arrayValue ? (value.arrayValue.values ?? []).map(one) : value.stringValue);
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, one(value)]));
}

/**
 * The next copy: what the server publishes now, and every row this phone held that the server no longer
 * publishes (kept so history still reads it).
 */
export function nextCopy(previous: CatalogCopy | null, published: Row[]): CatalogCopy {
  const live = new Set(published.map((row) => row.id));
  // A row is in one list or the other, never both; the retired list grows by one per unpublish.
  const retired = [...(previous?.published ?? []), ...(previous?.retired ?? [])].filter((row) => !live.has(row.id));
  return { published, retired };
}

/** The published rows, or null when the reply is not a query result (the last good copy stays). */
export function publishedRows(reply: unknown): Row[] | null {
  if (!Array.isArray(reply)) return null;
  return reply.flatMap((item) => {
    const fields = (item as { document?: { fields?: Record<string, Value> } })?.document?.fields;
    const row = fields ? plain(fields) : null;
    // Only published rows: the query asks for them and the rules serve nothing else to the public.
    return (row && validRow(row)) ?? [];
  });
}

/** After the first render, online: download the published rows and keep them for the next open. */
export async function refreshCatalog(): Promise<void> {
  if (location.hostname !== EVENTS_HOST && !(globalThis as { __catalogTest?: boolean }).__catalogTest) return;
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents:runQuery?key=${FIREBASE.apiKey}`,
      {
        // No JSON content type: Firestore parses the body anyway, and a plain POST skips the CORS preflight.
        method: 'POST',
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'catalog' }],
          where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
        } }),
      },
    );
    const published = response.ok ? publishedRows(await response.json()) : null;
    if (!published) return;
    const copy = nextCopy(await readCopy(), published);
    await (await caches.open(CATALOG_CACHE)).put(KEY, new Response(JSON.stringify(copy)));
  } catch {
    // Offline or refused: the last good copy stays.
  }
}
