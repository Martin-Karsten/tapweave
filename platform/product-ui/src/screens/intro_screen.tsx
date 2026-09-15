import { Show, createEffect, onCleanup, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Brand_Mark } from '../components/brand_mark';
import { retry_boot, shell_state } from '../state/session_state';

// The ready state stays on screen for at least the enter duration
// (--duration-enter) before the automatic advance, so the shell never flashes
// and the skip input always has a window; Enter, Space or a click ends the
// hold immediately.
const MINIMUM_INTRO_DISPLAY_MS = 600;

export const Intro_Screen: Component = () => {
  const navigate = useNavigate();
  let advance_timer: number | undefined;
  let advanced = false;

  const advance = (): void => {
    if (advanced || shell_state().phase !== 'ready') return;
    advanced = true;
    window.clearTimeout(advance_timer);
    // Replacing history keeps browser Back out of the intro after advancing.
    navigate('/menu', { replace: true });
  };

  const handle_keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      advance();
    }
  };

  // Keyboard listeners exist only while the intro accepts input (phase
  // ready); the root click handler no-ops outside ready, and the boot-failed
  // Retry button owns its own activation.
  createEffect((previously_ready: boolean | undefined) => {
    const ready = shell_state().phase === 'ready';
    if (ready && !previously_ready) {
      window.addEventListener('keydown', handle_keydown);
      advance_timer = window.setTimeout(advance, MINIMUM_INTRO_DISPLAY_MS);
    } else if (!ready && previously_ready) {
      window.removeEventListener('keydown', handle_keydown);
    }
    return ready;
  }, undefined);

  onCleanup(() => {
    window.removeEventListener('keydown', handle_keydown);
    window.clearTimeout(advance_timer);
  });

  return (
    <main class="screen intro-screen" aria-label="Intro" onClick={advance}>
      <Brand_Mark />
      <h1 class="wordmark-title">tapweave<span class="brand-dot">●</span></h1>
      <Show when={shell_state().phase === 'booting'}>
        <div class="intro-spinner" aria-hidden="true" />
        <p class="intro-status" role="status" aria-live="polite">
          Starting engine…
        </p>
      </Show>
      <Show when={shell_state().phase === 'ready'}>
        <p class="intro-status" role="status" aria-live="polite">
          Engine ready.
        </p>
        <p class="intro-hint">Press Enter or click to continue</p>
      </Show>
      <Show when={shell_state().phase === 'boot-failed'}>
        <p class="intro-error" role="alert">
          Engine failed to start. {shell_state().boot_error}
        </p>
        <div class="intro-actions">
          <button type="button" onClick={() => { void retry_boot(); }}>Retry</button>
          <A href="/diagnostics">Diagnostics</A>
        </div>
      </Show>
      <p class="intro-disclaimer">Independent rhythm game. Not affiliated with osu! or ppy.</p>
    </main>
  );
};
