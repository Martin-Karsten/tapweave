import { createEffect, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Brand_Mark } from '../components/brand_mark';
import { shell_state } from '../state/session_state';

// Placeholder menu step: the wordmark anchors the lazer logo position and the
// button column lets the intro advance land on a focused primary action. The
// full lazer button column and wedges arrive with the later menu step.
export const Main_Menu_Screen: Component = () => {
  const navigate = useNavigate();

  createEffect(() => {
    if (shell_state().phase === 'ready') {
      document.getElementById('menu-play')?.focus();
    }
  });

  return (
    <main class="screen menu-screen" aria-label="Main menu">
      <Brand_Mark />
      <h1 class="wordmark-title">tapweave<span class="brand-dot">●</span></h1>
      <nav class="menu-buttons" aria-label="Main menu">
        <button id="menu-play" type="button" onClick={() => navigate('/select')}>
          Play
        </button>
        <button id="menu-diagnostics" type="button" onClick={() => navigate('/diagnostics')}>
          Diagnostics
        </button>
      </nav>
    </main>
  );
};
