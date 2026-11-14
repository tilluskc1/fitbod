import type { MuscleGroup } from '../types';
import type { Area } from '../lib/areas';
import { DETAIL, OUTLINE, REGIONS, VIEWS, VIEW_H, VIEW_W, ZONES, mapSummary } from '../lib/bodyMap';
import type { Shade } from '../lib/bodyMap';

interface Props {
  /** The muscles the current pick trains: lime. */
  selected: MuscleGroup[];
  /** How recently each muscle was trained; empty without history (no shading, no legend). */
  shade: Shade;
  /** The areas with a chip on screen: only these are tap targets. */
  areas: Area[];
  /** A tap on an area does what its chip does. */
  onToggle: (area: Area) => void;
}

const MIRROR = `translate(${VIEW_W} 0) scale(-1 1)`;

/**
 * (#302) Front and back figure above the body-part chips (art: #366, `src/lib/bodyMap.ts`). The picture is hidden from screen
 * readers (the chips are the control) and summed up in one sentence instead. No animation.
 */
export default function BodyMap({ selected, shade, areas, onToggle }: Props) {
  const shaded = Object.keys(shade).length > 0;
  return (
    <div className="bm">
      <div className="bm-figs" aria-hidden="true">
        {VIEWS.map((view) => (
          <figure className="bm-fig" key={view}>
            <svg className="bm-svg" data-view={view} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} focusable="false">
              {OUTLINE.map((part, index) => (
                <g key={index} className="bm-body">
                  <path d={part.d} />
                  {part.mirror && <path d={part.d} transform={MIRROR} />}
                </g>
              ))}
              {REGIONS[view].map((region) => {
                const on = selected.includes(region.muscle);
                const tone = on ? 'bm-r--on' : shade[region.muscle] ? `bm-r--${shade[region.muscle]}` : '';
                return (
                  <g key={region.muscle} className={`bm-r ${tone}`} data-muscle={region.muscle} data-on={on || undefined}>
                    <path d={region.d} />
                    {region.mirror && <path d={region.d} transform={MIRROR} />}
                    {region.lines && <path className="bm-line" d={region.lines} />}
                    {region.lines && region.mirror && <path className="bm-line" d={region.lines} transform={MIRROR} />}
                  </g>
                );
              })}
              {DETAIL[view].map((d) => (
                <g key={d} className="bm-detail">
                  <path d={d} />
                  <path d={d} transform={MIRROR} />
                </g>
              ))}
              {ZONES[view].filter((zone) => areas.includes(zone.area)).map((zone) => (
                <rect
                  key={`${zone.area}-${zone.x}`}
                  className="bm-zone"
                  data-area={zone.area}
                  x={zone.x}
                  y={zone.y}
                  width={zone.w}
                  height={zone.h}
                  onClick={() => onToggle(zone.area)}
                />
              ))}
            </svg>
            <figcaption className="bm-cap">{view === 'front' ? 'Front' : 'Back'}</figcaption>
          </figure>
        ))}
      </div>
      {shaded && (
        <p className="bm-legend" aria-hidden="true"><span className="bm-swatch" />Darker = trained recently</p>
      )}
      <p className="sr-only">{mapSummary(selected, shade)}</p>
    </div>
  );
}
