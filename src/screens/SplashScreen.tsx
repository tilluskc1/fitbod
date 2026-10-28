import { exercisePhoto } from '../lib/media';

interface Props {
  onStart: () => void;
}

/**
 * Cold-open screen. One action and one honest promise: the app starts working
 * before an account, a plan or a single logged set exists.
 */
export default function SplashScreen({ onStart }: Props) {
  const photo = exercisePhoto('dumbbell-floor-press');

  return (
    <div className="splash">
      {photo && <img className="splash__photo" src={photo} alt="" />}
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
