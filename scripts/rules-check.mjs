// (#359) Live, read-only rules check: Firestore must refuse every admin read without the admin's token.
// (#360) Also: listing every catalog row (drafts included) is refused; the app's published-only query is not.
// It never writes. Run after the owner pastes firestore.rules:  node scripts/rules-check.mjs
// With ADMIN_CHECK_TOKEN set to a Firebase ID token of a non-admin Google account, it also checks
// that a signed-in stranger is refused.
const DB = 'https://firestore.googleapis.com/v1/projects/home-strength/databases/(default)/documents';
const KEY = 'AIzaSyA2efM2HsT1n1GpIiTrk4eFCkwREdFhUvo';
const reads = [
  ['list feedback', `${DB}/feedback?pageSize=1&key=${KEY}`, {}],
  ['query events', `${DB}:runQuery?key=${KEY}`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'events' }], limit: 1 } }) }],
  ['list every catalog row', `${DB}/catalog?pageSize=1&key=${KEY}`, {}],
];
// (#360) What phones run: published rows only. This one must be allowed.
const published = await fetch(`${DB}:runQuery?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: {
  from: [{ collectionId: 'catalog' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } }, limit: 1 } }) });
console.log(`${published.ok ? 'allowed' : 'NOT ALLOWED'} ${published.status}: signed out, published catalog rows`);
const who = [['signed out', {}]];
if (process.env.ADMIN_CHECK_TOKEN) who.push(['another account', { Authorization: `Bearer ${process.env.ADMIN_CHECK_TOKEN}` }]);
let failed = 0;
for (const [as, headers] of who) {
  for (const [what, url, init] of reads) {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
    const ok = response.status === 403;
    if (!ok) failed += 1;
    console.log(`${ok ? 'refused' : 'NOT REFUSED'} ${response.status}: ${as}, ${what}`);
  }
}
process.exit(failed || !published.ok ? 1 : 0);
