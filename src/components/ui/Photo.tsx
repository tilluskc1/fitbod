import { useState } from 'react';
import { exercisePhoto } from '../../lib/media';

interface Props {
  exerciseId: string;
  name: string;
  className?: string;
  eager?: boolean;
}

/**
 * Catalog photography with a labeled fallback. One frame is enough for static
 * rows; the old cross-fade component is not needed on the mobile surfaces.
 */
export default function Photo({ exerciseId, name, className = '', eager = false }: Props) {
  const [failed, setFailed] = useState(false);
  const src = exercisePhoto(exerciseId);

  return (
    <span className={`photo ${className}`} role="img" aria-label={`${name} demonstration`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="photo-fallback" aria-hidden="true">
          ◎
        </span>
      )}
    </span>
  );
}

