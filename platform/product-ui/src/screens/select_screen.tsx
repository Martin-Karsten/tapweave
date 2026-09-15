import { For, Show, createEffect, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Virtual_List } from '../components/virtual_list';
import { debug_dialog_open, open_debug_dialog } from '../state/debug_state';
import { player_session, shell_state } from '../state/session_state';

const map_display_name = (filename: string): string =>
  filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? filename;

const selection_status = (): string => {
  const state = shell_state();
  if (state.phase === 'booting') return 'Starting engine…';
  if (state.phase === 'boot-failed') return 'Engine unavailable.';
  if (state.selection.state === 'loading') return 'Preparing beatmap…';
  if (state.selection.active) return 'Beatmap prepared successfully.';
  return 'Engine ready. Open a beatmap to begin.';
};

export const Select_Screen: Component = () => {
  const navigate = useNavigate();
  const state = () => shell_state();
  const selection = () => state().selection;
  const active = () => selection().active;
  const gameplay = () => state().gameplay;
  const selection_locked = () => gameplay().in_attempt || gameplay().state === 'loading' || gameplay().state === 'disposed';
  const difficulty_rows = () => {
    const current = active();
    return current ? current.source.list_maps() : [];
  };

  const map_name = (): string => {
    const current = active();
    return current ? map_display_name(current.filename) : 'Ready when you are.';
  };

  const selection_error_message = (): string => {
    const error = selection().error;
    return error ? error.message : '';
  };

  const open_files = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    if (files.length) {
      void player_session()?.load_files(files);
    }
    input.value = '';
  };

  const choose_difficulty = (row_index: number) => {
    const filename = difficulty_rows()[row_index];
    if (filename !== undefined && filename !== active()?.filename) {
      void player_session()?.select_map(filename);
    }
  };

  const start_play = () => {
    navigate('/play');
    void player_session()?.play();
  };

  // Match the vanilla player: once playback is possible, focus Play so the
  // attempt can start from the keyboard.
  createEffect(() => {
    if (shell_state().gameplay.can_play && document.activeElement === document.body) {
      document.getElementById('start')?.focus();
    }
  });

  return (
    <main class="screen select-screen" aria-label="Beatmap preparation">
      <section class="panel selection" aria-label="Beatmap selection">
        <h2>Choose your beatmap</h2>
        <p>Load an .osz archive, or select an .osu file together with its music.</p>
        <label class="file-control">
          Open local files
          <input id="files" type="file" multiple aria-label="Open local files" disabled={selection_locked()} onChange={open_files} />
        </label>
        <Show when={difficulty_rows().length > 0}>
          <h3 id="difficulty-label">Difficulty</h3>
          <div class="difficulty-list" role="listbox" aria-labelledby="difficulty-label">
            <Virtual_List
              rows={difficulty_rows()}
              row_height={44}
              list_name="difficulties"
              aria_label="Difficulty"
              disabled={selection_locked()}
              render_row={(filename) => <span data-map-filename={filename}>{map_display_name(filename)}</span>}
              on_activate={choose_difficulty}
            />
          </div>
        </Show>
        <p id="status" role="status" aria-live="polite">
          {selection_status()}
        </p>
        <p id="error" role="alert" hidden={!selection().error}>
          {selection_error_message()}
        </p>
      </section>
      <section class="panel preview" aria-label="Beatmap overview">
        <p class="eyebrow">BEATMAP OVERVIEW</p>
        <h2 id="map-name">{map_name()}</h2>
        <Show when={active()} keyed>
          {(selection) => (
            <>
              <p id="map-detail">{selection.music_error || 'Music decoded. Prepared map and assets are ready.'}</p>
              <dl id="stats">
                <div>
                  <dt>Objects</dt>
                  <dd id="objects">{Number(selection.descriptor.summary.objects_count).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Circle size</dt>
                  <dd id="circle-size">{String(selection.descriptor.summary.cs)}</dd>
                </div>
                <div>
                  <dt>Approach rate</dt>
                  <dd id="approach-rate">{String(selection.descriptor.summary.ar)}</dd>
                </div>
              </dl>
            </>
          )}
        </Show>
        <Show when={!active()}>
          <p id="map-detail">Your files stay in this browser.</p>
        </Show>
        <button id="start" type="button" disabled={!gameplay().can_play} onClick={start_play}>
          Play
        </button>
        <p id="play-gate" class="gate">
          {gameplay().message}
        </p>
        <div class="debug-entry">
          <button id="debug-open" type="button" aria-expanded={debug_dialog_open()} onClick={open_debug_dialog}>
            Debug
          </button>
        </div>
        <p class="gate">Debug: Ctrl+F10 panel · Ctrl+F11 HUD during play (when the browser delivers them).</p>
        <Show when={active()?.samples?.warnings.length} keyed>
          {(warning_count) => (
            <ul class="warnings">
              <For each={active()!.samples!.warnings.slice(0, warning_count)}>{(warning) => <li>{warning}</li>}</For>
            </ul>
          )}
        </Show>
      </section>
    </main>
  );
};
