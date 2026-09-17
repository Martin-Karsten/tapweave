import { For, Show, createEffect, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Virtual_List } from '../components/virtual_list';
import { debug_dialog_open, open_debug_dialog } from '../state/debug_state';
import { player_session, shell_state } from '../state/session_state';
import { DECODE_ERROR_CODE } from '@browser/abi-records.js';
import type { Browser_Error } from '@browser/errors.js';
import type { Active_Selection } from '@browser/selection.js';

const map_display_name = (filename: string): string =>
  filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? filename;

// Decoder-owned song-select metadata, with filename fallback for explicitly
// empty fields. The decoder fills the pinned lazer defaults ("Unknown" /
// "Unknown" / "Unknown Creator" / "Normal"; lazer Beatmap.cs constructor at
// the pinned commit) for maps without a [Metadata] section, and those are
// legitimate values a beatmap can also set deliberately — they display like
// any other string, matching lazer's own song select. Only an empty value
// counts as absent.
type Metadata_Field = 'title' | 'artist' | 'creator' | 'version';

const metadata_value = (selection: Active_Selection, field: Metadata_Field): string | null => {
  const value = selection.descriptor.metadata[field];
  return value !== '' ? value : null;
};

// Filename-derived stand-in for the lazer set panel title: the shared prefix
// of the loaded scope's difficulty filenames, falling back to the active
// difficulty when decoder-owned title metadata is absent.
const set_display_title = (filenames: readonly string[], active_filename: string): string => {
  let shared_prefix = map_display_name(filenames[0] ?? active_filename);
  for (const filename of filenames.slice(1)) {
    const display_name = map_display_name(filename);
    let shared_length = 0;
    const shared_limit = Math.min(shared_prefix.length, display_name.length);
    while (shared_length < shared_limit && shared_prefix[shared_length] === display_name[shared_length]) {
      shared_length += 1;
    }
    shared_prefix = shared_prefix.slice(0, shared_length);
  }
  shared_prefix = shared_prefix.replace(/[\s\-_.([{$]+$/, '');
  return shared_prefix || map_display_name(active_filename);
};

const selection_status = (): string => {
  const state = shell_state();
  if (state.phase === 'booting') return 'Starting engine…';
  if (state.phase === 'boot-failed') return 'Engine unavailable.';
  if (state.selection.state === 'loading') return 'Preparing beatmap…';
  if (state.selection.active) return 'Beatmap prepared successfully.';
  return 'Engine ready. Open a beatmap to begin.';
};

// Lazer SongSelect structure (structure reference only): the FilterControl
// bar on top, the sheared BeatmapTitleWedge on the left, the beatmap-set
// carousel with expanded difficulty rows on the right, and a ScreenFooter
// action bar below.
export const Select_Screen: Component = () => {
  const navigate = useNavigate();
  const [difficulty_filter, set_difficulty_filter] = createSignal('');
  const [drop_active, set_drop_active] = createSignal(false);
  const state = () => shell_state();
  const selection = () => state().selection;
  const active = () => selection().active;
  const gameplay = () => state().gameplay;
  const selection_locked = () => gameplay().in_attempt || gameplay().state === 'loading' || gameplay().state === 'disposed';
  const difficulty_rows = () => {
    const current = active();
    return current ? current.source.list_maps() : [];
  };

  // Only the active difficulty is prepared; its row can show decoder-owned
  // version metadata while unprepared rows keep their filename labels. This
  // helper is the single label representation: the carousel rows and the
  // difficulty filter below both render and search through it.
  const difficulty_row_label = (filename: string): string => {
    const current = active();
    if (current && filename === current.filename) {
      const version = metadata_value(current, 'version');
      if (version !== null) return version;
    }
    return map_display_name(filename);
  };

  // The filter matches the displayed labels (version metadata for the active
  // row, filename bases otherwise), so searching what is shown finds the row.
  const visible_difficulty_rows = (): readonly string[] => {
    const query = difficulty_filter().trim().toLowerCase();
    if (!query) return difficulty_rows();
    return difficulty_rows().filter((filename) =>
      filename.toLowerCase().includes(query) || difficulty_row_label(filename).toLowerCase().includes(query));
  };

  const map_name = (): string => {
    const current = active();
    if (current) {
      const title = metadata_value(current, 'title');
      if (title !== null) return title;
    }
    return current ? map_display_name(current.filename) : 'Ready when you are.';
  };

  const map_artist = (): string | null => {
    const current = active();
    return current ? metadata_value(current, 'artist') : null;
  };

  const map_creator = (): string | null => {
    const current = active();
    const creator = current ? metadata_value(current, 'creator') : null;
    return creator !== null ? `mapped by ${creator}` : null;
  };

  const map_difficulty = (): string | null => {
    const current = active();
    if (!current) {
      return null;
    }
    const version = metadata_value(current, 'version');
    return version !== null && version !== map_display_name(current.filename) ? version : null;
  };

  const set_title = (): string => {
    const current = active();
    if (current) {
      const title = metadata_value(current, 'title');
      if (title !== null) return title;
    }
    return set_display_title(difficulty_rows(), active()?.filename ?? '');
  };

  const difficulty_count_text = (): string => {
    const count = difficulty_rows().length;
    return `${count} ${count === 1 ? 'difficulty' : 'difficulties'}`;
  };

  // Actionable copy for engine refusals the product can explain; the raw
  // engine message stays visible as the technical line underneath.
  const selection_error_text = (error: Browser_Error): { primary: string; technical: string | null } => {
    const filename = typeof error.details.filename === 'string' ? error.details.filename : null;
    const map_text = filename ? `"${filename}"` : 'The selected difficulty';
    if (error.details.status_name === 'UNSUPPORTED') {
      if (error.details.code === DECODE_ERROR_CODE.MODE) {
        return { primary: `${map_text} is a taiko, catch or mania difficulty. Only osu!standard difficulties are supported.`,
          technical: error.message };
      }
      if (error.details.code === DECODE_ERROR_CODE.FORMAT_VERSION) {
        return { primary: `${map_text} uses a beatmap format version this build does not support.`,
          technical: error.message };
      }
      return { primary: `${map_text} uses a beatmap feature this build does not support.`, technical: error.message };
    }
    return { primary: error.message, technical: null };
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
    const filename = visible_difficulty_rows()[row_index];
    if (filename !== undefined && filename !== active()?.filename) {
      void player_session()?.select_map(filename);
    }
  };

  const start_play = () => {
    navigate('/play');
    void player_session()?.play();
  };

  const back_to_menu = () => {
    navigate('/menu');
  };

  const drag_carries_files = (event: DragEvent): boolean =>
    (event.dataTransfer?.types ?? []).includes('Files');

  const handle_drag_over = (event: DragEvent) => {
    if (selection_locked() || !drag_carries_files(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    set_drop_active(true);
  };

  const handle_drag_leave = (event: DragEvent) => {
    const left_element = event.currentTarget;
    const next_target = event.relatedTarget;
    if (left_element instanceof Node && next_target instanceof Node && left_element.contains(next_target)) {
      return;
    }
    set_drop_active(false);
  };

  const handle_drop = (event: DragEvent) => {
    if (!drag_carries_files(event)) return;
    event.preventDefault();
    set_drop_active(false);
    if (selection_locked()) return;
    const dropped_files = [...(event.dataTransfer?.files ?? [])];
    if (dropped_files.length) {
      void player_session()?.load_files(dropped_files);
    }
  };

  // Match the vanilla player: once playback is possible, focus Play so the
  // attempt can start from the keyboard.
  createEffect(() => {
    if (shell_state().gameplay.can_play && document.activeElement === document.body) {
      document.getElementById('start')?.focus();
    }
  });

  return (
    <main
      class="screen select-screen"
      classList={{ 'drop-target': drop_active() }}
      data-drop-active={drop_active() ? 'true' : 'false'}
      aria-label="Beatmap selection"
      onDragOver={handle_drag_over}
      onDragLeave={handle_drag_leave}
      onDrop={handle_drop}
    >
      <header class="select-topbar" aria-label="Song select controls">
        <button id="select-back" type="button" aria-label="Back to menu" onClick={back_to_menu}>
          <span aria-hidden="true">←</span>
        </button>
        <h1 class="select-title">Song select</h1>
        <input
          id="difficulty-filter"
          class="difficulty-filter"
          type="search"
          placeholder="Filter difficulties"
          aria-label="Filter difficulties"
          value={difficulty_filter()}
          onInput={(event) => set_difficulty_filter(event.currentTarget.value)}
        />
        <label class="file-control">
          Open local files
          <input id="files" type="file" multiple aria-label="Open local files" disabled={selection_locked()} onChange={open_files} />
        </label>
      </header>
      <section class="select-carousel" aria-label="Beatmap set">
        <Show
          when={difficulty_rows().length > 0}
          fallback={<p class="carousel-empty">Load an .osz archive, or drop files onto this screen. An .osu file belongs with its music.</p>}
        >
          <div class="set-panel">
            <div class="set-panel-content">
              <h2 class="set-title">{set_title()}</h2>
              <p class="set-count">{difficulty_count_text()}</p>
            </div>
          </div>
          <h3 id="difficulty-label" class="difficulty-heading">Difficulty</h3>
          <div class="difficulty-list" role="listbox" aria-labelledby="difficulty-label">
            <Virtual_List
              rows={visible_difficulty_rows()}
              row_height={44}
              list_name="difficulties"
              aria_label="Difficulty"
              disabled={selection_locked()}
              render_row={(filename) => <span data-map-filename={filename}>{difficulty_row_label(filename)}</span>}
              on_activate={choose_difficulty}
            />
          </div>
          <Show when={difficulty_filter().trim() !== '' && visible_difficulty_rows().length === 0}>
            <p class="filter-empty">No difficulty matches this filter.</p>
          </Show>
        </Show>
        <p id="status" role="status" aria-live="polite">
          {selection_status()}
        </p>
        <Show when={selection().error} keyed>
          {(error) => {
            const error_text = selection_error_text(error);
            return (
              <div id="error" role="alert">
                <p id="error-message">{error_text.primary}</p>
                <Show when={error_text.technical}>
                  {(technical) => <p id="error-detail" class="error-detail">{technical()}</p>}
                </Show>
              </div>
            );
          }}
        </Show>
      </section>
      <section class="select-wedge" aria-label="Beatmap details">
        <div class="wedge-shear-edge">
          <p class="eyebrow">Beatmap details</p>
        </div>
        <div class="wedge-content">
          <h2 id="map-name">{map_name()}</h2>
          <Show when={map_artist()} keyed>
            {(artist) => <p id="map-artist" class="map-metadata">{artist}</p>}
          </Show>
          <Show when={map_creator()} keyed>
            {(creator) => <p id="map-creator" class="map-metadata">{creator}</p>}
          </Show>
          <Show when={map_difficulty()} keyed>
            {(difficulty) => <p id="map-difficulty" class="map-metadata">{difficulty}</p>}
          </Show>
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
                  <div>
                    <dt>Overall difficulty</dt>
                    <dd id="overall-difficulty">{String(selection.descriptor.summary.od)}</dd>
                  </div>
                  <div>
                    <dt>Health drain</dt>
                    <dd id="health-drain">{String(selection.descriptor.summary.hp)}</dd>
                  </div>
                </dl>
              </>
            )}
          </Show>
          <Show when={!active()}>
            <p id="map-detail">Your files stay in this browser.</p>
          </Show>
          <p id="play-gate" class="gate">
            {gameplay().message}
          </p>
          <Show when={active()?.samples?.warnings.length} keyed>
            {(warning_count) => (
              <ul class="warnings">
                <For each={active()!.samples!.warnings.slice(0, warning_count)}>{(warning) => <li>{warning}</li>}</For>
              </ul>
            )}
          </Show>
        </div>
      </section>
      <footer class="select-footer" aria-label="Song select actions">
        <button id="footer-back" type="button" onClick={back_to_menu}>
          <span>Back</span>
        </button>
        <p class="footer-shortcuts">Debug: Ctrl+F10 panel · Ctrl+F11 HUD during play (when the browser delivers them).</p>
        <div class="select-footer-buttons">
          <button id="start" type="button" disabled={!gameplay().can_play} onClick={start_play}>
            <span>Play</span>
          </button>
          <button id="debug-open" type="button" aria-expanded={debug_dialog_open()} onClick={open_debug_dialog}>
            <span>Debug</span>
          </button>
        </div>
      </footer>
    </main>
  );
};
