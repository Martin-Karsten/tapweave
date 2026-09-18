// Browser fullscreen owns the first Escape: exiting fullscreen must not also
// dispatch the application Escape action (pause, resume-gate cancel, watch
// exit, dialog close). Whether the engine delivers that keydown before or
// after the fullscreen exit differs by browser, so a live
// document.fullscreenElement check alone is not enough: engines that exit
// first fire fullscreenchange before the keydown arrives. The guard therefore
// also treats an Escape within a short grace window after a fullscreen exit
// as browser-owned. This suppresses UI/lifecycle Escape actions only; it
// never touches judgement, input records or engine state.
const FULLSCREEN_EXIT_GRACE_MS = 400;

let guarded_document: Document | null = null;
let last_fullscreen_exit_ms: number | null = null;

// Idempotent per document: gameplay input, the resume gate and the shell each
// install it from their constructors/mount, matching the package convention
// that production modules register no listeners at import time.
export function install_fullscreen_escape_guard(document: Document): void {
  if (guarded_document === document) return;
  guarded_document = document;
  last_fullscreen_exit_ms = null;
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) last_fullscreen_exit_ms = performance.now();
  });
}

// True while an Escape keydown belongs to the browser's fullscreen-exit
// gesture: either the document is still fullscreen, or a fullscreen exit
// happened within the grace window.
export function fullscreen_owns_escape(): boolean {
  if (!guarded_document) return false;
  if (guarded_document.fullscreenElement) return true;
  return last_fullscreen_exit_ms !== null &&
    performance.now() - last_fullscreen_exit_ms < FULLSCREEN_EXIT_GRACE_MS;
}
