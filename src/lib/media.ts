import media from '../data/media.json';

interface MediaEntry {
  frames: string[];
  source?: string;
  /** Optional looping demo clip, e.g. "/exercises/push-up/demo.mp4". */
  video?: string;
}

const MEDIA = media as Record<string, MediaEntry>;

/** Every catalog frame for an exercise, in start → end order. */
export function exerciseFrames(exerciseId: string): string[] {
  return MEDIA[exerciseId]?.frames ?? [];
}

/** First catalog frame for an exercise, or null when it has no photography. */
export function exercisePhoto(exerciseId: string): string | null {
  return exerciseFrames(exerciseId)[0] ?? null;
}

/** Looping demo clip when the catalog ships one. */
export function exerciseVideo(exerciseId: string): string | null {
  return MEDIA[exerciseId]?.video ?? null;
}
