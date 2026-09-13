import { Engine_Bridge } from './engine-bridge.js';
import type { Engine_Diagnostic, Prepared_Descriptor_Record } from './abi-records.js';
import { Selection_Controller } from './selection.js';
import { create_fallback_audio } from './fallback-audio.js';
import { Gameplay_Controller, type Gameplay_View } from './gameplay-controller.js';
import { Browser_Error } from './errors.js';

const element = (identifier: string) => document.getElementById(identifier)!;
const diagnostics: Record<string, unknown> = { scope: 'M3 integrated validation player', upstream_verified: false,
  gameplay: false, browser: navigator.userAgent, messages: [] as Engine_Diagnostic[] };
const stringify = (value: unknown) => JSON.stringify(value, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value, 2);
let engine: Engine_Bridge | undefined;
let selection: Selection_Controller | undefined;
let audio_context: AudioContext | undefined;
let gameplay: Gameplay_Controller | undefined;
let previous_state = '';

function update(controller: Selection_Controller) {
  const active = controller.active;
  element('status').textContent = controller.state === 'loading' ? 'Preparing beatmap…' :
    active ? 'Beatmap prepared successfully.' : 'Engine ready. Open a beatmap to begin.';
  element('error').hidden = !controller.error;
  element('error').textContent = controller.error ? controller.error.message : '';
  const difficulty = element('difficulty') as HTMLSelectElement;
  difficulty.disabled = !active || controller.state === 'loading';
  if (active) {
    difficulty.replaceChildren(...active.source.list_maps().map(filename => {
      const option = document.createElement('option');
      option.value = filename;
      option.textContent = filename;
      option.selected = filename === active.filename;
      return option;
    }));
    element('map-name').textContent = active.filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? active.filename;
    element('map-detail').textContent = active.music_error || 'Music decoded. Prepared map and assets are ready.';
    const summary: Prepared_Descriptor_Record = active.descriptor.summary;
    element('stats').hidden = false;
    element('objects').textContent = summary.objects_count.toLocaleString();
    element('circle-size').textContent = String(summary.cs);
    element('approach-rate').textContent = String(summary.ar);
    diagnostics.map = { filename: active.filename, summary, music: active.music_status };
  }
  diagnostics.error = controller.error ? { code: controller.error.code, message: controller.error.message,
    details: controller.error.details } : null;
  diagnostics.wasm_pages = engine!.wasm.memory.buffer.byteLength / 65536;
  element('diagnostics').textContent = stringify(diagnostics);
}

function update_gameplay(view: Gameplay_View) {
  if (selection) update(selection);
  const start = element('start') as HTMLButtonElement;
  start.disabled = !view.can_play;
  element('play-gate').textContent = view.message;
  (element('files') as HTMLInputElement).disabled = view.in_attempt || view.state === 'loading' || view.state === 'disposed';
  (element('difficulty') as HTMLSelectElement).disabled = !selection?.active || view.in_attempt || view.state === 'loading';
  element('player').hidden = !view.in_attempt;
  document.querySelector<HTMLElement>('.workspace')!.hidden = view.in_attempt;
  document.querySelector<HTMLElement>('.intro')!.hidden = view.in_attempt;
  const panel_visible = view.in_attempt && view.state !== 'running';
  element('lifecycle-panel').hidden = !panel_visible;
  element('pause').hidden = view.state !== 'running';
  element('resume').hidden = view.state !== 'paused';
  (element('resume') as HTMLButtonElement).disabled = !view.can_resume;
  (element('retry') as HTMLButtonElement).disabled = !view.can_retry;
  element('lifecycle-title').textContent = view.state === 'terminal' ? view.message :
    view.state === 'recovering' ? 'Playback interrupted' : view.state === 'starting' ? 'Starting…' : 'Paused';
  element('lifecycle-message').textContent = view.state === 'terminal' ? 'Run complete. Retry or return to selection.' : view.message;
  element('result-stats').hidden = !view.result;
  if (view.result) {
    const summary = view.result.summary;
    const items: [string, string][] = [['Score', String(summary.score)], ['Accuracy', `${(Number(summary.accuracy) * 100).toFixed(2)}%`],
      ['Rank', ['X', 'S', 'A', 'B', 'C', 'D', 'F'][Number(summary.rank)] ?? String(summary.rank)], ['Max combo', String(summary.highest_combo)]];
    const result_names = ['None', 'Miss', 'Meh', 'Ok', 'Good', 'Great', 'Perfect', 'Small tick miss', 'Small tick hit',
      'Large tick miss', 'Large tick hit', 'Small bonus', 'Large bonus', 'Ignored miss', 'Ignored hit', 'Combo break', 'Slider tail hit'];
    for (let result_index = 0; result_index < view.result.spans.get('counts')!.count; result_index++) {
      const count = view.result.record('counts', result_index);
      if (Number(count.actual) || Number(count.maximum)) items.push([result_names[Number(count.result)] ?? `Result ${count.result}`, String(count.actual)]);
    }
    element('result-stats').replaceChildren(...items.map(([label, text]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = text;
      item.append(term, description); return item;
    }));
  }
  diagnostics.gameplay = view.can_play || view.in_attempt;
  diagnostics.lifecycle = { state: view.state, message: view.message, recovery: view.recovery, error: view.error instanceof Error ? view.error.message : view.error };
  diagnostics.samples = selection?.active?.samples?.warnings;
  diagnostics.result = view.result ? { summary: view.result.summary,
    counts: Array.from({ length: view.result.spans.get('counts')!.count }, (_, result_index) => view.result!.record('counts', result_index)) } : null;
  element('diagnostics').textContent = stringify(diagnostics);
  if (previous_state !== view.state) {
    if (view.state === 'running') element('playfield').focus();
    else if (panel_visible) element('lifecycle-panel').focus();
    else if (view.can_play && previous_state !== '') start.focus();
    previous_state = view.state;
  }
}

try {
  const response = await fetch('/tapweave.wasm');
  if (!response.ok) {
    throw new Error('Engine download failed. Build the browser assets and try again.');
  }
  engine = await Engine_Bridge.create(await response.arrayBuffer(), message => {
    if ((diagnostics.messages as Engine_Diagnostic[]).length === 64) {
      (diagnostics.messages as Engine_Diagnostic[]).shift();
    }
    (diagnostics.messages as Engine_Diagnostic[]).push(message);
  });
  diagnostics.engine = engine.capabilities;
  diagnostics.preparation = engine.preparation_capabilities;
  audio_context = new AudioContext();
  const fallback_assets = new Map<string, AudioBuffer>();
  selection = new Selection_Controller(engine, {
    fallback_assets,
    on_change: () => {},
    decode_audio: async bytes => {
      audio_context ??= new AudioContext();
      if (fallback_assets.size === 0) {
        for (const [name, buffer] of create_fallback_audio(audio_context)) fallback_assets.set(name, buffer);
      }
      return audio_context.decodeAudioData(bytes as ArrayBuffer);
    },
  });
  gameplay = new Gameplay_Controller(engine, selection, audio_context, element('playfield') as HTMLCanvasElement, { on_change: update_gameplay });
  element('files').addEventListener('change', event => {
    const files = [...((event.target as HTMLInputElement).files ?? [])];
    if (files.length) {
      void gameplay!.load_files(files);
    }
    (event.target as HTMLInputElement).value = '';
  });
  element('difficulty').addEventListener('change', event => {
    void gameplay!.select_map((event.target as HTMLSelectElement).value);
  });
} catch (error) {
  element('status').textContent = 'Engine unavailable.';
  element('error').hidden = false;
  element('error').textContent = error instanceof Browser_Error || error instanceof Error ? error.message : String(error);
  (element('files') as HTMLInputElement).disabled = true;
  selection?.dispose();
  engine?.dispose();
  void audio_context?.close();
}

element('export').addEventListener('click', () => {
  const object_url = URL.createObjectURL(new Blob([stringify(diagnostics)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = object_url;
  link.download = 'tapweave-diagnostics.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(object_url), 1000);
});

for (const command of ['play', 'pause', 'resume', 'retry', 'back'] as const) {
  element(command === 'play' ? 'start' : command).addEventListener('click', () => { void gameplay?.[command](); });
}

// Keep keyboard navigation inside an active lifecycle overlay. Gameplay bindings
// are detached before this panel is shown, so Enter/Space cannot submit hits.
element('lifecycle-panel').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const buttons = [...element('lifecycle-panel').querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => !button.hidden && !button.disabled);
  if (!buttons.length) return;
  const focused_index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (focused_index < 0 || (!event.shiftKey && focused_index === buttons.length - 1) ||
    (event.shiftKey && focused_index === 0)) {
    event.preventDefault();
    buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
  }
});
