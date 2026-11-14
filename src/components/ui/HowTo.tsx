import { useLayoutEffect, useRef, useState } from 'react';
import Sheet from './Sheet';
import Demo from './Demo';
import { exerciseFrames, exerciseVideo } from '../../lib/media';
import { exerciseById } from '../../data/exercises';

/** Up to three cues: the first sentences of the written instructions. */
const cues = (text = ''): string[] =>
  (text.match(/[^.!?]+[.!?]*/g) ?? []).map((cue) => cue.trim()).filter(Boolean).slice(0, 3);

/**
 * (#379) Full-screen how-to: the clip fills the width, muted and looped. iOS refuses `play()` in Low
 * Power Mode unless it runs inside a tap, so the first call happens in the opening tap's own commit
 * and "Play video" is a tap too. Refused, broken or not playing after 4 s, the two photos loop
 * instead (#231). Never a blank or an endless spinner.
 */
export default function HowTo({ exerciseId, name, onClose }: { exerciseId: string; name: string; onClose: () => void }) {
  const video = exerciseVideo(exerciseId);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState<boolean | null>(video ? null : false);
  const stop = () => setPlaying((now) => now || false);
  const play = () => void ref.current?.play().catch(stop);

  useLayoutEffect(() => {
    play();
    const timer = setTimeout(stop, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Sheet title={name} onClose={onClose} variant="player" headingId="howto-title">
      <span className="howto-media">
        {video && (
          <video ref={ref} className="demo-video" src={video} poster={exerciseFrames(exerciseId)[0]}
            muted loop playsInline preload="auto" hidden={playing === false}
            onPlaying={() => setPlaying(true)} onError={stop} />
        )}
        {playing === false && <Demo exerciseId={exerciseId} name={name} still eager />}
      </span>
      {playing === false && (
        <p className="howto-note" role="status">
          {!video ? 'No video yet' : navigator.onLine ? (
            <button type="button" className="pill-quiet" onClick={play}>Play video</button>
          ) : 'Video needs a connection'}
        </p>
      )}
      <p className="howto-name" aria-hidden="true">{name}</p>
      <ul className="howto-cues">
        {cues(exerciseById(exerciseId)?.instructions).map((cue) => <li key={cue}>{cue}</li>)}
      </ul>
    </Sheet>
  );
}
