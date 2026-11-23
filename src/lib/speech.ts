/** The handful of Web Speech API members this file reads or calls. Not the full DOM lib type. */
export interface SpeechResultEvent {
  results: { 0: { transcript: string } }[];
}
export interface SpeechErrorEvent {
  error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  // #203 renders this component server-side (react-dom-server) in tests, where there is no window.
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Feature-detect only; R1 (#426) says the mic shows only where this is true. */
export function voiceSupported(): boolean {
  return speechRecognitionCtor() !== null;
}

/** A fresh recognizer, or null when the browser has none (R1: the mic is hidden instead). */
export function newRecognition(): SpeechRecognitionLike | null {
  const Ctor = speechRecognitionCtor();
  return Ctor ? new Ctor() : null;
}
