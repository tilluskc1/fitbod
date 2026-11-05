export interface RestTick {
  /** Seconds left on the previous tick. */
  prev: number;
  remaining: number;
  /** A rest clock exists (false once the rest was cleared or the session ended). */
  active: boolean;
  paused: boolean;
  muted: boolean;
}

/** True on the one tick where a running rest reaches zero. */
export function restEnded({ prev, remaining, active, paused }: RestTick): boolean {
  return active && !paused && prev > 0 && remaining === 0;
}

/** The tone and vibration fire only for that tick, and never when muted. */
export function shouldCue(tick: RestTick): boolean {
  return !tick.muted && restEnded(tick);
}

// Mute lasts for the open workout (its session id): in memory only, never stored.
let mutedSession: string | null = null;
export const isRestMuted = (sessionId: string) => mutedSession === sessionId;
export const setRestMuted = (sessionId: string, value: boolean) => {
  mutedSession = value ? sessionId : null;
};

let audio: AudioContext | null = null;

/** Call from a user gesture so the browser lets the end-of-rest tone play. */
export function primeRestAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // Web Audio unavailable: the cue degrades to vibration only.
  }
}

export function playRestCue(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration blocked or unsupported.
  }
  try {
    if (!audio) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.2, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
    osc.frequency.value = 880;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.4);
  } catch {
    // Tone is best effort.
  }
}
