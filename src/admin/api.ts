import { FIREBASE } from '../lib/firebase.ts';
import type { FirestoreDoc } from '../lib/adminData.ts';

/**
 * (#359) Admin reads and the one write (Mark done), over Firestore REST with the Firebase ID token
 * from Google sign-in. No SDK. The client never checks who is signed in: the rules decide, and a
 * refusal comes back here as `not-allowed`. The token lives in memory only.
 */
const DB = `projects/${FIREBASE.projectId}/databases/(default)/documents`;
const BASE = 'https://firestore.googleapis.com/v1';

export type Failure = 'not-allowed' | 'expired' | 'offline';

export class AdminError extends Error {
  readonly kind: Failure;
  constructor(kind: Failure) {
    super(kind);
    this.kind = kind;
  }
}

async function call(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  } catch {
    throw new AdminError('offline');
  }
  if (response.status === 401) throw new AdminError('expired');
  if (response.status === 403) throw new AdminError('not-allowed');
  if (!response.ok) throw new AdminError('offline');
  return response.json();
}

/** Google's ID token in, a Firebase ID token out. Any refusal reads as not allowed. */
export async function signInWithGoogle(googleIdToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri: location.origin,
        returnSecureToken: true,
      }),
    });
  } catch {
    throw new AdminError('offline');
  }
  const body = (await response.json().catch(() => ({}))) as { idToken?: string };
  if (!response.ok || !body.idToken) throw new AdminError('not-allowed');
  return body.idToken;
}

/** Every feedback note, page by page (at most 10 pages of 300). */
export async function readFeedback(token: string): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const url = `${BASE}/${DB}/feedback?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const body = (await call(url, token)) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(body.documents ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return docs;
}

/** Events dated on or after `since` (YYYY-MM-DD). */
export async function readEvents(token: string, since: string): Promise<FirestoreDoc[]> {
  const rows = (await call(`${BASE}/${DB}:runQuery`, token, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'events' }],
        where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } },
      },
    }),
  })) as Array<{ document?: FirestoreDoc }>;
  return (Array.isArray(rows) ? rows : []).flatMap((row) => (row.document ? [row.document] : []));
}

/** Set or clear one note's done flag; nothing else on the note changes. */
export async function setDone(token: string, name: string, done: boolean): Promise<void> {
  await call(`${BASE}/${name}?updateMask.fieldPaths=done&currentDocument.exists=true`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { done: { booleanValue: done } } }),
  });
}

/** (#360) Every catalog row, drafts included (the rules let only the admin read those). */
export async function readCatalog(token: string): Promise<FirestoreDoc[]> {
  const body = (await call(`${BASE}/${DB}/catalog?pageSize=300`, token)) as { documents?: FirestoreDoc[] };
  return body.documents ?? [];
}

/**
 * (#360) Writes one catalog row whole. A new row must not exist yet (`currentDocument.exists=false`), so
 * two tabs can't both create the same id; a saved row is replaced, so a removed photo goes too.
 */
export async function writeCatalog(token: string, id: string, fields: Record<string, unknown>, isNew: boolean): Promise<void> {
  await call(`${BASE}/${DB}/catalog/${id}${isNew ? '?currentDocument.exists=false' : ''}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

/**
 * (#360) Uploads one photo or video to Firebase Storage over REST, with the admin's Firebase token. A
 * multipart upload, as Firebase's own SDK sends it, so the object keeps its content type (the Storage
 * rules check it; a plain media upload is stored as application/octet-stream).
 */
export function uploadBody(path: string, file: Blob, boundary = `hs-${Math.random().toString(36).slice(2)}`): { type: string; body: Blob } {
  const head = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: path, contentType: file.type })}\r\n`
    + `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`;
  return { type: `multipart/related; boundary=${boundary}`, body: new Blob([head, file, `\r\n--${boundary}--`]) };
}

export async function uploadMedia(token: string, bucket: string, path: string, file: Blob): Promise<void> {
  const { type, body } = uploadBody(path, file);
  let response: Response;
  try {
    response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': type, 'X-Goog-Upload-Protocol': 'multipart', Authorization: `Firebase ${token}` },
      body,
    });
  } catch {
    throw new AdminError('offline');
  }
  if (response.status === 401) throw new AdminError('expired');
  if (response.status === 403) throw new AdminError('not-allowed');
  if (!response.ok) throw new AdminError('offline');
}
