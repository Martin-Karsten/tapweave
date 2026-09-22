import { For, Show, createEffect, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Virtual_List } from '../components/virtual_list';
import { debug_dialog_open, open_debug_dialog } from '../state/debug_state';
import { demo_error_message, demo_request_state, request_demo } from '../state/demo_state';
import { player_session, shell_state } from '../state/session_state';
import { DECODE_ERROR_CODE } from '@browser/abi-records.js';
import { drain_ms, playable_span_of } from '@browser/map-summary.js';
import type { Browser_Error } from '@browser/errors.js';
import type { Active_Selection } from '@browser/selection.js';
import type { Selection_Set_Snapshot } from '../services/player_session';
import {
  difficulty_row_label as label_for_row,
  format_bpm,
  format_duration_ms,
  map_display_name,
  metadata_field,
  row_meta_text as meta_for_row,
  set_artist_for,
  set_count_text,
  set_title_for as title_for_set,
} from '../services/selection_display';

// Grouped-carousel row model: one header per loaded set, its difficulty rows
// indented under it; headers collapse their set.
type Carousel_Row =
  | { kind: 'set'; set: Selection_Set_Snapshot }
  | { kind: 'difficulty'; set: Selection_Set_Snapshot; filename: string };

const selection_status = (): string => {
  const state = shell_state();
  if (state.phase === 'booting') return 'Starting engine…';
  if (state.phase === 'boot-failed') return 'Engine unavailable.';
  if (state.selection.state === 'loading') return 'Preparing beatmap…';
  if (state.selection.active) return 'Beatmap prepared successfully.';
  return 'Engine ready. Open a beatmap to begin.';
};

const stat_fill_percent = (value: number): string =>
  `${Math.max(0, Math.min(100, value * 10))}%`;

// Brief per-stat explanations (mvp-player-experience.md); the wedge shows
// them as native tooltips on each stat row.
const STAT_EXPLANATIONS = {
  hp: 'Health drain — how quickly health drains while playing. Higher values recover less.',
  cs: 'Circle size — smaller circles are harder to hit.',
  ar: 'Approach rate — higher means objects appear closer to their hit time.',
  od: 'Overall difficulty — higher tightens hit timings and spinner requirements.',
};

// Lazer SongSelect structure (structure reference only): the FilterControl
// bar on top, the sheared BeatmapTitleWedge on the left, the loaded-set
// carousel with grouped difficulty rows on the right, and a ScreenFooter
// action bar below. The grouping/collapse interaction is a browser-product
// idiom (ADR-007 divergence), not a lazer carousel claim.
export const Select_Screen: Component = () => {
  const navigate = useNavigate();
  const [difficulty_filter, set_difficulty_filter] = createSignal('');
  const [drop_active, set_drop_active] = createSignal(false);
  const [collapsed_set_ids, set_collapsed_set_ids] = createSignal<ReadonlySet<number>>(new Set());
  const state = () => shell_state();
  const selection = () => state().selection;
  const active = () => selection().active;
  const gameplay = () => state().gameplay;
  const selection_locked = () => gameplay().in_attempt || gameplay().state === 'loading' || gameplay().state === 'disposed';
  const loaded_sets = () => selection().sets;
  const active_set = (): Selection_Set_Snapshot | null => {
    const current = active();
    return current ? loaded_sets().find((loaded_set) => loaded_set.set_id === current.set_id) ?? null : null;
  };

  // Row labels come from the shared display helpers; this wrapper binds the
  // active selection. The label is the single search representation too: the
  // carousel rows and the difficulty filter both render and match through it.
  const difficulty_row_label = (loaded_set: Selection_Set_Snapshot, filename: string): string =>
    label_for_row(loaded_set, active(), filename);

  const set_title_for = (loaded_set: Selection_Set_Snapshot): string =>
    title_for_set(loaded_set, active());

  const toggle_set_collapsed = (set_id: number) => {
    set_collapsed_set_ids((previous_ids) => {
      const next_ids = new Set(previous_ids);
      if (next_ids.has(set_id)) {
        next_ids.delete(set_id);
      } else {
        next_ids.add(set_id);
      }
      return next_ids;
    });
  };

  // The filter searches across the whole library: matching sets auto-expand
  // (their headers stay visible above the matching rows) and non-matching
  // sets drop out entirely.
  const visible_rows = (): readonly Carousel_Row[] => {
    const query = difficulty_filter().trim().toLowerCase();
    const rows: Carousel_Row[] = [];
    for (const loaded_set of loaded_sets()) {
      if (query) {
        const set_text_match =
          set_title_for(loaded_set).toLowerCase().includes(query) ||
          (set_artist_for(loaded_set) ?? '').toLowerCase().includes(query);
        const matching_filenames = set_text_match ? [...loaded_set.filenames] : loaded_set.filenames.filter((filename) => {
          const label = difficulty_row_label(loaded_set, filename);
          return filename.toLowerCase().includes(query) || label.toLowerCase().includes(query);
        });
        if (matching_filenames.length === 0) continue;
        rows.push({ kind: 'set', set: loaded_set });
        for (const filename of matching_filenames) {
          rows.push({ kind: 'difficulty', set: loaded_set, filename });
        }
      } else {
        rows.push({ kind: 'set', set: loaded_set });
        if (!collapsed_set_ids().has(loaded_set.set_id)) {
          for (const filename of loaded_set.filenames) {
            rows.push({ kind: 'difficulty', set: loaded_set, filename });
          }
        }
      }
    }
    return rows;
  };

  const map_name = (): string => {
    const current = active();
    if (current) {
      const title = metadata_field(current, 'title');
      if (title !== null) return title;
    }
    return current ? map_display_name(current.filename) : 'Ready when you are.';
  };

  const map_artist = (): string | null => {
    const current = active();
    return current ? metadata_field(current, 'artist') : null;
  };

  const map_creator = (): string | null => {
    const current = active();
    const creator = current ? metadata_field(current, 'creator') : null;
    return creator !== null ? `mapped by ${creator}` : null;
  };

  const map_difficulty = (): string | null => {
    const current = active();
    if (!current) {
      return null;
    }
    const version = metadata_field(current, 'version');
    return version !== null && version !== map_display_name(current.filename) ? version : null;
  };

  // The big set panel mirrors the active set; counts come from the snapshot.
  const set_panel_title = (): string => {
    const current_set = active_set();
    return current_set ? set_title_for(current_set) : 'Ready when you are.';
  };
  const set_panel_artist = (): string | null => {
    const current_set = active_set();
    return current_set ? set_artist_for(current_set) : null;
  };
  const set_panel_count = (): string => {
    const current_set = active_set();
    return current_set ? set_count_text(current_set) : '';
  };

  // Playable span and drain for the active difficulty, derived once per
  // selection from the prepared descriptor (mvp-player-experience.md).
  const active_span = () => {
    const current = active();
    return current ? playable_span_of(current.descriptor) : null;
  };
  const active_drain_ms = () => {
    const current = active();
    const span = active_span();
    if (!current || !span) return null;
    return drain_ms(span.start_ms, span.end_ms, [...current.descriptor.breaks()]);
  };
  const duration_chip_text = (): string | null => {
    const current_set = active_set();
    const current = active();
    const summary = current && current_set ? current_set.summaries.get(current.filename) : undefined;
    if (summary) return format_duration_ms(summary.duration_ms) || null;
    const span = active_span();
    return span ? format_duration_ms(span.end_ms - span.start_ms) || null : null;
  };
  const duration_chip_title = (): string => {
    const drain = active_drain_ms();
    const drain_text = format_duration_ms(drain);
    return drain_text ? `Playable duration; drain time ${drain_text}.` : 'Playable duration.';
  };
  const bpm_chip_text = (): string | null => {
    const current_set = active_set();
    const current = active();
    const summary = current && current_set ? current_set.summaries.get(current.filename) : undefined;
    if (!summary) return null;
    return format_bpm(summary.bpm_min, summary.bpm_max) || null;
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
      void player_session()?.add_files(files);
    }
    input.value = '';
  };

  // Enter on a header toggles the set; Enter on a difficulty selects it.
  const activate_row = (row_index: number) => {
    const row = visible_rows()[row_index];
    if (!row) return;
    if (row.kind === 'set') {
      toggle_set_collapsed(row.set.set_id);
      return;
    }
    const current = active();
    if (current === null || current.set_id !== row.set.set_id || current.filename !== row.filename) {
      void player_session()?.select_map(row.set.set_id, row.filename);
    }
  };

  const remove_loaded_set = (set_id: number, event: MouseEvent) => {
    event.stopPropagation();
    if (selection_locked()) return;
    void player_session()?.remove_set(set_id);
  };

  const start_play = () => {
    navigate('/play');
    void player_session()?.play();
  };

  const back_to_menu = () => {
    navigate('/menu');
  };

  // The demo button shares the import gate (no selection changes while an
  // attempt runs) and shows its own in-flight label while the archive loads.
  const demo_button_disabled = () =>
    selection_locked() || demo_request_state() === 'loading';
  const demo_button_label = () =>
    demo_request_state() === 'loading' ? 'Loading demo…' : 'Try the demo';
  const start_demo = () => {
    void request_demo();
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
      void player_session()?.add_files(dropped_files);
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
        <button id="try-demo" type="button" class="demo-button" disabled={demo_button_disabled()} onClick={start_demo}>
          {demo_button_label()}
        </button>
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
      <section class="select-carousel" aria-label="Beatmap sets">
        <Show
          when={loaded_sets().length > 0}
          fallback={
            <div class="carousel-empty">
              <p class="carousel-empty-lead">First time here? Try the demo — a beginner beatmap with original music.</p>
              <button id="try-demo-empty" type="button" class="demo-button" disabled={demo_button_disabled()} onClick={start_demo}>
                {demo_button_label()}
              </button>
              <p class="carousel-empty-hint">
                Or add an .osz archive, or drop files onto this screen. Every import joins your
                session library; an .osu file belongs with its music.
              </p>
            </div>
          }
        >
          <div class="set-panel">
            <div class="set-panel-content">
              <div class="set-heading">
                <h2 class="set-title">{set_panel_title()}</h2>
                <Show when={set_panel_artist()} keyed>
                  {(artist) => <p class="set-artist">{artist}</p>}
                </Show>
              </div>
              <p class="set-count">{set_panel_count()}</p>
            </div>
          </div>
          <h3 id="difficulty-label" class="difficulty-heading">Beatmap sets</h3>
          <div class="difficulty-list" role="listbox" aria-labelledby="difficulty-label">
            <Virtual_List
              rows={visible_rows()}
              row_height={48}
              list_name="difficulties"
              aria_label="Beatmap sets and difficulties"
              disabled={selection_locked()}
              fill_height
              render_row={(row) =>
                row.kind === 'set' ? (
                  <span class="difficulty-row set-header-row" data-set-id={row.set.set_id}>
                    <span class="set-chevron" aria-hidden="true">
                      {collapsed_set_ids().has(row.set.set_id) ? '▸' : '▾'}
                    </span>
                    <span class="set-header-title">{set_title_for(row.set)}</span>
                    <span class="set-header-count">{set_count_text(row.set)}</span>
                    <button
                      type="button"
                      class="set-remove"
                      aria-label={`Remove ${set_title_for(row.set)} from this session`}
                      disabled={selection_locked()}
                      onClick={(event) => remove_loaded_set(row.set.set_id, event)}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span class="difficulty-row" data-map-filename={row.filename}>
                    <span class="difficulty-row-label">{difficulty_row_label(row.set, row.filename)}</span>
                    <Show when={meta_for_row(row.set, row.filename)} keyed>
                      {(meta) => <span class="difficulty-row-meta">{meta}</span>}
                    </Show>
                  </span>
                )
              }
              on_activate={activate_row}
            />
          </div>
          <Show when={difficulty_filter().trim() !== '' && visible_rows().length === 0}>
            <p class="filter-empty">No difficulty matches this filter.</p>
          </Show>
        </Show>
        {/* The status/error strip: the carousel's bottom grid row, pinned
            under the bounded difficulty list. Demo fetch feedback lives here
            too: a transient loading line, or the retry affordance whose
            failure never touched the standing selection. */}
        <div class="select-status-strip">
          <p id="status" role="status" aria-live="polite">
            {selection_status()}
          </p>
          <Show when={demo_request_state() === 'loading'}>
            <p id="demo-status" role="status">Fetching the demo beatmap…</p>
          </Show>
          <Show when={demo_request_state() === 'failed'} keyed>
            <div id="demo-error" role="alert">
              <p id="demo-error-message">
                {demo_error_message() ?? 'Demo download failed.'} Your current selection is unchanged.
              </p>
              <button id="demo-retry" type="button" onClick={start_demo}>
                Retry
              </button>
            </div>
          </Show>
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
        </div>
      </section>
      <section class="select-wedge" aria-label="Beatmap details">
        <div class="wedge-shear-edge">
          <p class="eyebrow">Beatmap details</p>
        </div>
        <div class="wedge-content">
          <h2 id="map-name">{map_name()}</h2>
          <Show when={map_artist()} keyed>
            {(artist) => <p id="map-artist" class="map-artist">{artist}</p>}
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
                <div class="wedge-chips" aria-label="Beatmap timing">
                  <Show when={duration_chip_text()} keyed>
                    {(duration) => <span id="chip-duration" class="chip" title={duration_chip_title()}>{duration}</span>}
                  </Show>
                  <Show when={bpm_chip_text()} keyed>
                    {(bpm) => <span id="chip-bpm" class="chip" title="Beats per minute range over the map's timing points.">{bpm} BPM</span>}
                  </Show>
                  <span id="objects" class="chip" title="Hit objects in this difficulty.">
                    {Number(selection.descriptor.summary.objects_count).toLocaleString()} objects
                  </span>
                </div>
                <dl id="stats">
                  <div class="stat-row" title={STAT_EXPLANATIONS.hp}>
                    <dt>Health drain</dt>
                    <dd id="health-drain">{String(selection.descriptor.summary.hp)}</dd>
                    <div class="stat-track">
                      <div class="stat-fill" style={{ '--stat-fill': stat_fill_percent(selection.descriptor.summary.hp) }} />
                    </div>
                  </div>
                  <div class="stat-row" title={STAT_EXPLANATIONS.cs}>
                    <dt>Circle size</dt>
                    <dd id="circle-size">{String(selection.descriptor.summary.cs)}</dd>
                    <div class="stat-track">
                      <div class="stat-fill" style={{ '--stat-fill': stat_fill_percent(selection.descriptor.summary.cs) }} />
                    </div>
                  </div>
                  <div class="stat-row" title={STAT_EXPLANATIONS.ar}>
                    <dt>Approach rate</dt>
                    <dd id="approach-rate">{String(selection.descriptor.summary.ar)}</dd>
                    <div class="stat-track">
                      <div class="stat-fill" style={{ '--stat-fill': stat_fill_percent(selection.descriptor.summary.ar) }} />
                    </div>
                  </div>
                  <div class="stat-row" title={STAT_EXPLANATIONS.od}>
                    <dt>Overall difficulty</dt>
                    <dd id="overall-difficulty">{String(selection.descriptor.summary.od)}</dd>
                    <div class="stat-track">
                      <div class="stat-fill" style={{ '--stat-fill': stat_fill_percent(selection.descriptor.summary.od) }} />
                    </div>
                  </div>
                </dl>
              </>
            )}
          </Show>
          <Show when={!active()}>
            <p id="map-detail">Tap circles with the mouse or Z/X, hold sliders, spin spinners. Escape pauses.</p>
            <p id="privacy-note" class="map-metadata">Your files stay in this browser.</p>
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
