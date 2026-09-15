import type { Component } from 'solid-js';

// Inline wordmark mark (ring with an accent orbit dot). Pure SVG so the intro
// and menu render before the engine finishes booting; no binary assets.
export const Brand_Mark: Component = () => {
  return (
    <svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="4.5" />
      <circle cx="24" cy="7" r="5.5" fill="var(--color-accent)" />
    </svg>
  );
};
