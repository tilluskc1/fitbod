// #420: Storage photos refresh behind the cached copy, and only a confirmed-ok response is cached.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const URL_ = 'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media';

type Reply = { ok: boolean; status: number; type?: string; body: string };
function setup(replies: Reply[]) {
  const store = new Map<string, any>();
  const calls: { mode: string }[] = [];
  const mk = (r: Reply) => ({ ...r, clone() { return r; } });
  const cache = {
    match: async (req: any) => store.get(req.url),
    put: async (req: any, res: any) => { store.set(req.url, res); },
  };
  let handler: any;
  const sandbox: any = {
    self: { addEventListener: (n: string, f: any) => { if (n === 'fetch') handler = f; }, location: { origin: 'https://app.test' } },
    caches: { open: async () => cache },
    fetch: async (req: any) => { calls.push({ mode: req.mode }); const r = replies.shift(); if (!r) throw new Error('offline'); return mk(r); },
    Request: class { url: string; mode: string; constructor(u: string, o: any = {}) { this.url = u; this.mode = o.mode ?? 'cors'; } },
    Response: class { status: number; ok: boolean; constructor(_b: string, o: any) { this.status = o.status; this.ok = false; } },
    URL, setTimeout, clearTimeout, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const run = async (mode = 'no-cors') => {
    const req: any = { method: 'GET', url: URL_, mode, destination: 'image' };
    let out: any; const waits: Promise<unknown>[] = [];
    handler({ request: req, respondWith: (p: Promise<any>) => { out = p; }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = await out; await Promise.all(waits); return res;
  };
  return { store, calls, run };
}

test('a failed fetch is not cached, opaque or not', async () => {
  const t = setup([{ ok: false, status: 404, body: 'err' }, { ok: false, status: 0, type: 'opaque', body: 'opaque' }]);
  await t.run('cors');
  assert.equal(t.store.size, 0);
  await t.run('no-cors');
  assert.equal(t.store.size, 0);
});

test('a plain <img> request is refetched as cors so success can be confirmed and cached', async () => {
  const t = setup([{ ok: true, status: 200, body: 'v1' }]);
  const res = await t.run('no-cors');
  assert.equal(res.body, 'v1');
  assert.equal(t.calls[0].mode, 'cors');
  assert.equal(t.store.get(URL_).body, 'v1');
});

test('a cached photo is served at once and replaced after a successful refetch', async () => {
  const t2 = setup([{ ok: true, status: 200, body: 'new' }]);
  t2.store.set(URL_, { ok: true, status: 200, body: 'old' });
  const res = await t2.run();
  assert.equal(res.body, 'old', 'first paint uses the cached copy');
  assert.equal(t2.store.get(URL_).body, 'new', 'cache holds the replacement');
});

test('a failed refresh keeps the cached photo', async () => {
  const t = setup([{ ok: false, status: 500, body: 'err' }, { ok: false, status: 500, body: 'err' }]);
  t.store.set(URL_, { ok: true, status: 200, body: 'old' });
  assert.equal((await t.run()).body, 'old');
  assert.equal(t.store.get(URL_).body, 'old');
});
