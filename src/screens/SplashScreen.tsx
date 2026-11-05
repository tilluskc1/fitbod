import { useState } from 'react';

const HERO_VIDEO = '/hero/splash.mp4';
const HERO_POSTER = '/hero/splash-poster.jpg';

/** Decorative hero: a muted loop, or only its still frame when motion is reduced. */
export function SplashHero({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) return <img className="splash__photo" src={HERO_POSTER} alt="" />;
  return (
    <video
      // iOS Safari autoplays only when the muted *attribute* is present; React sets just the property.
      ref={(el) => {
        if (el) el.defaultMuted = true;
      }}
      className="splash__photo"
      src={HERO_VIDEO}
      poster={HERO_POSTER}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
    />
  );
}

interface Props {
  onStart: () => void;
}

/**
 * Cold-open screen. One action and one honest promise: the app starts working
 * before an account, a plan or a single logged set exists.
 */
export default function SplashScreen({ onStart }: Props) {
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );

  return (
    <div className="splash">
      <SplashHero reduceMotion={reduceMotion} />
      <span className="splash__shade" aria-hidden="true" />

      <div className="splash__inner">
        <span className="splash__brand">
          YOUR STRENGTH <b>·</b> COACH
        </span>

        <div className="splash__copy">
          <h1 className="splash__title">Every set, accounted for.</h1>
          <p className="splash__sub">
            One full-body program. Your loads, your reps, your history — kept on this device.
          </p>
        </div>

        <div className="splash__foot">
          <button className="pill-primary" onClick={onStart}>
            Get started
          </button>
          <span className="splash__note">No account. Nothing leaves this browser.</span>
        </div>
      </div>
    </div>
  );
}
