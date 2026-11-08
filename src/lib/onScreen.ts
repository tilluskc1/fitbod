type Observer = Pick<IntersectionObserver, 'observe' | 'disconnect'>;
type ObserverCtor = new (callback: IntersectionObserverCallback) => Observer;

/**
 * Reports whether an element is on screen, so a looping demo can pause off screen (#231).
 * Without IntersectionObserver (old browsers, server render) it reports on screen once and
 * never pauses: the loop then behaves as it did before. Returns the cleanup.
 */
export function watchOnScreen(
  element: Element,
  onChange: (onScreen: boolean) => void,
  Ctor: ObserverCtor | undefined = (globalThis as { IntersectionObserver?: ObserverCtor }).IntersectionObserver,
): () => void {
  if (!Ctor) {
    onChange(true);
    return () => {};
  }
  const observer = new Ctor((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) onChange(entry.isIntersecting);
  });
  observer.observe(element);
  return () => observer.disconnect();
}
