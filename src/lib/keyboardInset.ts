/**
 * #256: on iPhone (and Android Chrome without interactive-widget) the on-screen keyboard covers
 * the page instead of shrinking it, so a bar pinned to `bottom: 0` ends up under the keyboard.
 * The visual viewport says how much is covered; publish it as `--kb` for CSS to lift the bar.
 */
export interface ViewportLike {
  height: number;
  offsetTop: number;
}

/** Pixels of the layout viewport hidden below the visual viewport (the keyboard), never negative. */
export function keyboardInset(innerHeight: number, viewport: ViewportLike | null | undefined): number {
  if (!viewport) return 0;
  return Math.max(0, Math.round(innerHeight - viewport.height - viewport.offsetTop));
}

/** Keep `--kb` on the root element in step with the visual viewport. */
export function trackKeyboardInset(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => undefined;
  const root = win.document.documentElement;
  const update = () => {
    const inset = keyboardInset(win.innerHeight, vv);
    root.style.setProperty('--kb', `${inset}px`);
    // What the phone scrolled off the top to show the field (iPhone), for scroll-margin-top.
    root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
    // The phone revealed the focused field before the bar moved up; reveal it again so its
    // scroll-margin (which includes --kb) keeps it above the lifted bar.
    const field = win.document.activeElement;
    if (inset > 0 && field && /^(TEXTAREA|INPUT)$/.test(field.tagName)) {
      (field as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
