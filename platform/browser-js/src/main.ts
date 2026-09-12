import { Engine_Bridge } from './engine-bridge.js';
import type { Engine_Diagnostic, Prepared_Descriptor_Record } from './abi-records.js';
import { Selection_Controller } from './selection.js';
import { create_fallback_audio } from './fallback-audio.js';
import { Browser_Error } from './errors.js';

const element = (identifier: string) => document.getElementById(identifier)!;
const diagnostics: Record<string, unknown> = { scope: 'M3 independent browser foundation', upstream_verified: false,
  gameplay: false, browser: navigator.userAgent, messages: [] as Engine_Diagnostic[] };
const stringify = (value: unknown) => JSON.stringify(value, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value, 2);
let engine: Engine_Bridge | undefined;
let selection: Selection_Controller | undefined;
let audio_context: AudioContext | undefined;

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
  // A future gameplay bit alone cannot enable a player without all M3 protocols.
  const fallback_assets = new Map<string, AudioBuffer>();
  selection = new Selection_Controller(engine, {
    fallback_assets,
    on_change: update,
    decode_audio: async bytes => {
      audio_context ??= new AudioContext();
      if (fallback_assets.size === 0) {
        for (const [name, buffer] of create_fallback_audio(audio_context)) fallback_assets.set(name, buffer);
      }
      return audio_context.decodeAudioData(bytes as ArrayBuffer);
    },
  });
  update(selection);
  element('files').addEventListener('change', event => {
    const files = [...((event.target as HTMLInputElement).files ?? [])];
    if (files.length) {
      void selection!.load_files(files);
    }
    (event.target as HTMLInputElement).value = '';
  });
  element('difficulty').addEventListener('change', event => {
    void selection!.select_map((event.target as HTMLSelectElement).value);
  });
} catch (error) {
  element('status').textContent = 'Engine unavailable.';
  element('error').hidden = false;
  element('error').textContent = error instanceof Browser_Error || error instanceof Error ? error.message : String(error);
  (element('files') as HTMLInputElement).disabled = true;
  engine?.dispose();
}

element('export').addEventListener('click', () => {
  const object_url = URL.createObjectURL(new Blob([stringify(diagnostics)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = object_url;
  link.download = 'tapweave-diagnostics.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(object_url), 1000);
});

window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    selection?.dispose();
    engine?.dispose();
    void audio_context?.close();
  }
});
