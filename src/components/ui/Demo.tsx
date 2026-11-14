import { useEffect, useRef, useState } from 'react';
import { exerciseFrames, exerciseVideo } from '../../lib/media';
import { watchOnScreen } from '../../lib/onScreen';

interface Props {
  exerciseId: string;
  name: string;
  className?: string;
  eager?: boolean;
  /** Photos only, even when a clip exists: the player's fallback (#379). */
  still?: boolean;
}

/**
 * Exercise demonstration. Plays a demo clip when the catalog has one, otherwise
 * loops the start → end frames as a crossfade, about 1 s per pose (#231), so the
 * movement reads as a demo rather than a still. Respects prefers-reduced-motion
 * through CSS (first frame only; no JS branch, so the server and client agree).
 * The loop pauses while the demo is off screen; a closed sheet unmounts it.
 */
export default function Demo({ exerciseId, name, className = '', eager = false, still = false }: Props) {
  const [failed, setFailed] = useState(false);
  // (#379) iOS refuses play() in Low Power Mode; the photos loop instead of a frozen poster.
  const [refused, setRefused] = useState(still);
  const frames = exerciseFrames(exerciseId);
  const video = refused ? null : exerciseVideo(exerciseId);
  const [first, second] = frames;
  const ref = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || failed || (!video && !second)) return;
    return watchOnScreen(element, setOnScreen);
  }, [failed, video, second]);

  useEffect(() => {
    const clip = ref.current?.querySelector('video');
    if (!clip) return;
    if (onScreen) void clip.play().catch((error: Error) => setRefused(error.name === 'NotAllowedError'));
    else clip.pause();
  }, [onScreen, video]);

  const fallback = (
    <span className="photo-fallback" aria-hidden="true">
      ◎
    </span>
  );

  return (
    <span
      ref={ref}
      className={`photo demo${onScreen ? '' : ' demo--paused'} ${className}`}
      role="img" aria-label={`${name} demonstration`}>
      {failed ? (
        fallback
      ) : video ? (
        <video
          className="demo-video"
          src={video}
          poster={first}
          autoPlay
          loop
          muted
          playsInline
          preload={eager ? 'auto' : 'metadata'}
          onError={() => setFailed(true)}
        />
      ) : first ? (
        <>
          <img
            src={first}
            alt=""
            className="demo-frame demo-frame-base"
            loading={eager ? 'eager' : 'lazy'}
            onError={() => setFailed(true)}
          />
          {second && (
            <img
              key={second}
              src={second}
              alt=""
              className="demo-frame demo-frame-alt"
              loading={eager ? 'eager' : 'lazy'}
              // A clip's poster is cached offline but its end frame may never have loaded: keep the start frame.
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          )}
        </>
      ) : (
        fallback
      )}
    </span>
  );
}
