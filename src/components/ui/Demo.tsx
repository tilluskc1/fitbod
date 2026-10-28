import { useState } from 'react';
import { exerciseFrames, exerciseVideo } from '../../lib/media';

interface Props {
  exerciseId: string;
  name: string;
  className?: string;
  eager?: boolean;
}

/**
 * Exercise demonstration. Plays a demo clip when the catalog has one, otherwise
 * loops the start → end frames so the movement reads as a demo rather than a
 * still. Respects prefers-reduced-motion through CSS (no JS branch, so the
 * server and client agree).
 */
export default function Demo({ exerciseId, name, className = '', eager = false }: Props) {
  const [failed, setFailed] = useState(false);
  const frames = exerciseFrames(exerciseId);
  const video = exerciseVideo(exerciseId);
  const [first, second] = frames;

  const fallback = (
    <span className="photo-fallback" aria-hidden="true">
      ◎
    </span>
  );

  return (
    <span className={`photo demo ${className}`} role="img" aria-label={`${name} demonstration`}>
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
              src={second}
              alt=""
              className="demo-frame demo-frame-alt"
              loading={eager ? 'eager' : 'lazy'}
              onError={() => setFailed(true)}
            />
          )}
        </>
      ) : (
        fallback
      )}
    </span>
  );
}
