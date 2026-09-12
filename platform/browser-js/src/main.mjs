import { Engine_Bridge } from './engine-bridge.mjs';
import { Selection_Controller } from './selection.mjs';

const element = identifier => document.getElementById(identifier);
const diagnostics = { scope: 'M3 independent browser foundation', upstream_verified: false, gameplay: false,
  browser: navigator.userAgent, messages: [] };
const stringify = value => JSON.stringify(value, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value, 2);
let engine;
let selection;
let audio_context;

function update(controller) {
  const active = controller.active;
  element('status').textContent = controller.state === 'loading' ? 'Preparing beatmap…' :
    active ? 'Beatmap prepared successfully.' : 'Engine ready. Open a beatmap to begin.';
  element('error').hidden = !controller.error;
  element('error').textContent = controller.error ? controller.error.message : '';
  const difficulty = element('difficulty');
  difficulty.disabled = !active || controller.state === 'loading';
  if (active) {
    difficulty.replaceChildren(...active.source.list_maps().map(filename => {
      const option = document.createElement('option');
      option.value = filename;
      option.textContent = filename;
      option.selected = filename === active.filename;
      return option;
    }));
    element('map-name').textContent = active.filename.split('/').at(-1).replace(/\.osu$/i, '');
    element('map-detail').textContent = active.music_error || 'Music decoded. Prepared map and assets are ready.';
    const summary = active.descriptor.summary;
    element('stats').hidden = false;
    element('objects').textContent = summary.objects_count.toLocaleString();
    element('circle-size').textContent = summary.cs;
    element('approach-rate').textContent = summary.ar;
    diagnostics.map = { filename: active.filename, summary, music: active.music_status };
  }
  diagnostics.error = controller.error ? { code: controller.error.code, message: controller.error.message, details: controller.error.details } : null;
  diagnostics.wasm_pages = engine.wasm.memory.buffer.byteLength / 65536;
  element('diagnostics').textContent = stringify(diagnostics);
}

try {
  const response = await fetch('/tapweave.wasm');
  if (!response.ok) {
    throw new Error('Engine download failed. Build the browser assets and try again.');
  }
  engine = await Engine_Bridge.create(await response.arrayBuffer(), message => {
    if (diagnostics.messages.length === 64) {
      diagnostics.messages.shift();
    }
    diagnostics.messages.push(message);
  });
  diagnostics.engine = engine.capabilities;
  diagnostics.preparation = engine.preparation_capabilities;
  // A future gameplay bit alone cannot enable a player without all M3 protocols.
  selection = new Selection_Controller(engine, {
    on_change: update,
    decode_audio: async bytes => {
      audio_context ??= new AudioContext();
      return audio_context.decodeAudioData(bytes);
    },
  });
  update(selection);
  element('files').addEventListener('change', event => {
    const files = [...event.target.files];
    if (files.length) {
      void selection.load_files(files);
    }
    event.target.value = '';
  });
  element('difficulty').addEventListener('change', event => {
    void selection.select_map(event.target.value);
  });
} catch (error) {
  element('status').textContent = 'Engine unavailable.';
  element('error').hidden = false;
  element('error').textContent = error.message;
  element('files').disabled = true;
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
