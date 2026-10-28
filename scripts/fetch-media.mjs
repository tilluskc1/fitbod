import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbUrl = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const imgBase = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

const src = fs.readFileSync(path.join(root, 'src/data/exercises.ts'), 'utf8');
const our = [...src.matchAll(/\{ id: '([^']+)', name: '([^']+)', muscles: \[([^\]]*)\], equipment: '([^']+)'/g)].map((m) => ({
  id: m[1],
  name: m[2],
  muscles: [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  equipment: m[4],
}));

if (our.length < 20) {
  console.error(`Exercise parse looks wrong, only found ${our.length}`);
  process.exit(1);
}

console.log(`Parsed ${our.length} exercises from exercises.ts`);

const db = await (await fetch(dbUrl)).json();

const eqMap = {
  Barbell: 'barbell',
  Dumbbell: 'dumbbell',
  Machine: 'machine',
  Cable: 'cable',
  Kettlebell: 'kettlebells',
  Bodyweight: 'body only',
};
const mmap = {
  Chest: ['chest'],
  Back: ['lats', 'middle back', 'lower back'],
  Shoulders: ['shoulders'],
  Biceps: ['biceps'],
  Triceps: ['triceps'],
  Quads: ['quadriceps'],
  Hamstrings: ['hamstrings'],
  Glutes: ['glutes'],
  Calves: ['calves'],
  Core: ['abdominals'],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s) => new Set(norm(s).split(' ').filter(Boolean));
const tokenScore = (a, b) => {
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / Math.max(1, a.size, b.size);
};

function score(o, c) {
  const ns = norm(o.name) === norm(c.name) ? 1 : tokenScore(toks(o.name), toks(c.name));
  const eq = (c.equipment || '') === (eqMap[o.equipment] || '') ? 1 : 0;
  const dbm = new Set([...(c.primaryMuscles || []), ...(c.secondaryMuscles || [])]);
  const mh = o.muscles.some((m) => (mmap[m] || []).some((x) => dbm.has(x))) ? 1 : 0;
  return { total: ns * 0.62 + eq * 0.18 + mh * 0.2, ns };
}

const overrides = {
  'barbell-bench-press': 'Barbell_Bench_Press_-_Medium_Grip',
  'dumbbell-floor-press': 'Dumbbell_Floor_Press',
  'barbell-row': 'Bent_Over_Barbell_Row',
  'overhead-press': 'Barbell_Shoulder_Press',
  dip: 'Dips_-_Chest_Version',
  'pull-up': 'Pullups',
  'push-up': 'Pushups',
  'diamond-push-up': 'Push-Ups_-_Close_Triceps_Position',
  'glute-bridge': 'Butt_Lift_Bridge',
  'cable-kickback': 'One-Legged_Cable_Kickback',
  'step-up': 'Dumbbell_Step_Ups',
  'standing-calf-raise': 'Standing_Calf_Raises',
  'skull-crusher': 'EZ-Bar_Skullcrusher',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'leg-extension': 'Leg_Extensions',
  'cable-curl': 'Standing_Biceps_Cable_Curl',
};

const results = our.map((o) => {
  const cands = db.map((c) => ({ c, s: score(o, c) })).sort((a, b) => b.s.total - a.s.total);
  const best = overrides[o.id] ? cands.find((x) => x.c.id === overrides[o.id]) : cands[0];
  const accepted = Boolean(best) && (Boolean(overrides[o.id]) || best.s.ns >= 0.34);
  return { o, best, accepted };
});

console.log('\nMATCH REPORT');
for (const r of results) {
  const chosen = r.accepted ? r.best.c.id : '— placeholder —';
  const ns = r.best ? r.best.s.ns.toFixed(2) : '0.00';
  console.log(`${r.o.id.padEnd(26)} ${ns}  ->  ${chosen}`);
}

const media = {};
let downloaded = 0;
const failures = [];

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const tasks = [];
fs.rmSync(path.join(root, 'public/exercises'), { recursive: true, force: true });
for (const r of results) {
  if (!r.accepted) continue;
  const dbId = r.best.c.id;
  const frames = r.best.c.images || [];
  if (frames.length < 2) {
    failures.push(`${r.o.id}: no image frames in db entry`);
    continue;
  }
  const dests = frames.slice(0, 2).map((f) => `/exercises/${r.o.id}/${path.basename(f)}`);
  media[r.o.id] = { frames: dests, source: dbId };
  for (const [i, f] of frames.slice(0, 2).entries()) {
    tasks.push(() =>
      download(imgBase + f, path.join(root, 'public', dests[i])).then(() => {
        downloaded += 1;
      }),
    );
  }
}

const CONCURRENCY = 6;
let next = 0;
async function worker() {
  while (next < tasks.length) {
    const i = next++;
    try {
      await tasks[i]();
    } catch (err) {
      failures.push(String(err));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/data/media.json'), JSON.stringify(media, null, 2));

const matched = results.filter((r) => r.accepted).length;
console.log(`\nMatched ${matched}/${results.length} exercises, downloaded ${downloaded} images.`);
if (failures.length) console.log('Failures:\n' + failures.join('\n'));
