import { useEffect, useMemo, useState } from 'react';
import { EXERCISES } from '../data/exercises.ts';
import { STUDIO_KITS, catalogCard, catalogFlags, coverage, musclesWithCounts } from '../lib/catalog.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import type { MuscleGroup } from '../types.ts';

/** Dev-only catalog studio (#230): every exercise, its frames and the gaps, in one place. Read-only. */

type Tab = 'exercises' | 'coverage' | 'flags';
const KIT_LABEL = Object.fromEntries(STUDIO_KITS.map((kit) => [kit.id, kit.label]));
const label = (pattern: string) => pattern.replace(/_/g, ' ');

function Card({ card }: { card: CatalogCard }) {
  return (
    <article className="card" id={card.id}>
      <div className="card__frames">
        {card.frames.length === 0 && <div className="card__noframe">No frames</div>}
        {card.frames.map((frame, index) => (
          <figure key={frame}>
            <img src={frame} alt="" loading="lazy" />
            <figcaption>{index === 0 ? 'Start' : index === card.frames.length - 1 ? 'Finish' : `Frame ${index + 1}`}</figcaption>
          </figure>
        ))}
      </div>
      <h3>{card.name}</h3>
      <p className="mono">{card.id}</p>
      <div className="chips">
        <span className={`chip chip--${card.role.toLowerCase()}`}>{card.role}</span>
        <span className="chip">{card.equipment}</span>
        <span className="chip">{label(card.pattern)}</span>
      </div>
      <dl>
        <dt>Muscles</dt><dd>{card.muscles.join(', ')}</dd>
        <dt>Needs</dt><dd>{card.needs.length ? card.needs.join(', ') : 'nothing'}</dd>
        <dt>Also trains</dt><dd>{card.secondaryPatterns.length ? card.secondaryPatterns.map(label).join(', ') : '—'}</dd>
        <dt>Reps</dt><dd>{card.repRange}</dd>
        {card.leadRanges && (
          <><dt>As lead</dt><dd>{card.leadRanges.muscle} muscle · {card.leadRanges.strength} strength · {card.leadRanges.beginner} beginner</dd></>
        )}
        <dt>Kits</dt><dd>{card.kits.map((kit) => KIT_LABEL[kit]).join(', ') || 'none'}</dd>
        <dt>Swaps</dt><dd>{card.swaps.length ? card.swaps.join(', ') : <span className="gap">none</span>}</dd>
        <dt>Video</dt><dd>{card.video ?? <span className="muted">empty slot</span>}</dd>
        <dt>Source</dt><dd className="mono">{card.source ?? '—'}</dd>
      </dl>
    </article>
  );
}

function CoverageGrid() {
  const [by, setBy] = useState<'muscle' | 'pattern'>('muscle');
  const grid = useMemo(() => coverage(by), [by]);
  const gaps = grid.rows.reduce((sum, row) => sum + grid.kits.filter((kit) => grid.cell(row, kit).length === 0).length, 0);
  return (
    <section>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Rows">
          <button type="button" aria-pressed={by === 'muscle'} onClick={() => setBy('muscle')}>By muscle</button>
          <button type="button" aria-pressed={by === 'pattern'} onClick={() => setBy('pattern')}>By movement</button>
        </div>
        <p className="muted">{gaps} empty cells. Bands run bodyweight moves: the catalog has no band exercises.</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{by === 'muscle' ? 'Primary muscle' : 'Primary movement'}</th>{grid.kits.map((kit) => <th scope="col" key={kit}>{KIT_LABEL[kit]}</th>)}</tr></thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row}>
                <th scope="row">{by === 'muscle' ? row : label(row)}</th>
                {grid.kits.map((kit) => {
                  const names = grid.cell(row, kit);
                  return (
                    <td key={kit} className={names.length === 0 ? 'cell cell--gap' : names.length === 1 ? 'cell cell--thin' : 'cell'}>
                      <b>{names.length || 'Gap'}</b>
                      <span>{names.join(', ')}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Studio() {
  const [tab, setTab] = useState<Tab>('exercises');
  const [muscle, setMuscle] = useState<MuscleGroup | 'All'>('All');
  const [query, setQuery] = useState('');
  // Every frame is checked once on open, not only the cards in view, so Flags is complete (#230 review).
  const [broken, setBroken] = useState<{ id: string; path: string }[]>([]);
  const [checked, setChecked] = useState(0);
  const rail = useMemo(() => musclesWithCounts(), []);
  const cards = useMemo(() => EXERCISES.map((exercise) => catalogCard(exercise.id)), []);
  const frames = useMemo(() => cards.flatMap((card) => card.frames.map((path) => ({ id: card.id, path }))), [cards]);
  useEffect(() => {
    let live = true;
    for (const frame of frames) {
      const image = new Image();
      image.onload = () => { if (live) setChecked((count) => count + 1); };
      image.onerror = () => {
        if (!live) return;
        setChecked((count) => count + 1);
        setBroken((list) => [...list, frame]);
      };
      image.src = frame.path;
    }
    return () => { live = false; };
  }, [frames]);
  const checking = checked < frames.length;
  const flags = useMemo(() => [
    ...catalogFlags(),
    ...broken.map((frame) => ({ kind: 'broken-frame' as const, exerciseId: frame.id, detail: `${frame.path} did not load` })),
  ], [broken]);
  const shown = cards.filter((card) => (muscle === 'All' || card.muscles[0] === muscle)
    && (query === '' || `${card.name} ${card.id}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="studio">
      <header className="top">
        <div>
          <h1>Catalog studio</h1>
          <p className="muted">{cards.length} exercises · {cards.filter((card) => card.frames.length > 0).length} with frames · {cards.filter((card) => card.video).length} with video · read-only, dev only</p>
        </div>
        <nav className="seg" aria-label="View">
          {(['exercises', 'coverage', 'flags'] as Tab[]).map((name) => (
            <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>
              {name === 'flags' ? `Flags (${flags.length})` : name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'exercises' && (
        <div className="layout">
          <aside className="rail" aria-label="Body parts">
            <button type="button" aria-pressed={muscle === 'All'} onClick={() => setMuscle('All')}>All <span>{cards.length}</span></button>
            {rail.map((row) => (
              <button key={row.muscle} type="button" aria-pressed={muscle === row.muscle} onClick={() => setMuscle(row.muscle)}>
                {row.muscle} <span>{row.count}</span>
              </button>
            ))}
          </aside>
          <main>
            <input className="search" type="search" placeholder="Search name or id" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search exercises" />
            <div className="cards">{shown.map((card) => <Card key={card.id} card={card} />)}</div>
            {shown.length === 0 && <p className="muted">Nothing matches.</p>}
          </main>
        </div>
      )}

      {tab === 'coverage' && <CoverageGrid />}

      {tab === 'flags' && (
        <section>
          {checking && <p className="muted">Checking frames: {checked} of {frames.length}…</p>}
          {flags.length === 0 && !checking && (
            <p className="ok">Nothing to curate: every exercise has frames that load, every media entry has an exercise, and every exercise has a swap.</p>
          )}
          {flags.length > 0 && (
            <ul className="flags">
              {flags.map((flag, index) => <li key={`${flag.kind}-${flag.exerciseId}-${index}`}><span className="chip">{flag.kind}</span> {flag.detail}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
