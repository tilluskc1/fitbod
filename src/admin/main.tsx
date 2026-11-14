import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
// Inlined, so the training app's bundle carries no CSS-preload helper for this chunk.
import css from './admin.css?inline';

/** (#359) The /admin page, loaded only on that path (see src/main.tsx). */
export function mountAdmin(root: HTMLElement): void {
  document.title = 'Home Strength admin';
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
