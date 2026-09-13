import type { Decode_Audio } from './audio-decoder.js';
import { normalize_asset_path, type Asset_Access } from './archive.js';
import type { Engine_Bridge } from './engine-bridge.js';
import type { Prepared_Description } from './engine-bridge.js';
import type { Sample_Binding_Values } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';

export interface Sample_Candidate {
  object_id: number;
  component_id: number;
  sample_index: number;
  name: string;
  use_beatmap: boolean;
  candidates: string[];
}

export interface Loaded_Samples {
  assets: Map<bigint, AudioBuffer>;
  bindings: Sample_Binding_Values[];
  warnings: string[];
}

export interface Sample_Loading_Options {
  fallback_assets?: Map<string, AudioBuffer>;
  maximum_assets?: number;
  maximum_bindings?: number;
  cancelled?: () => boolean;
}

// Resource lookup only: every available candidate is bound independently.
// The engine, never this loader, selects the first available prepared candidate
// and owns the pinned extension probe order published by oe_sample_probe.
export async function load_sample_assets(descriptor: Prepared_Description, source: Asset_Access,
  map_filename: string, decode_audio: Decode_Audio, probe_extensions: string[],
  { fallback_assets = new Map<string, AudioBuffer>(), maximum_assets = 4096, maximum_bindings = 1_000_000,
    cancelled = () => false }: Sample_Loading_Options = {}): Promise<Loaded_Samples> {
  require_condition(typeof decode_audio === 'function' && Number.isSafeInteger(maximum_assets) &&
    maximum_assets > 0 && Number.isSafeInteger(maximum_bindings) && maximum_bindings > 0 &&
    Array.isArray(probe_extensions) && probe_extensions.length > 0 &&
    probe_extensions.every(extension => typeof extension === 'string' && extension.length <= 7 &&
      (extension === '' || (/^\.[-\w]+$/.test(extension) && extension === extension.toLowerCase()))),
    'INVALID_ARGUMENT', 'A decoder, positive sample asset limit and engine probe extensions are required.');
  const directory = map_filename.slice(0, map_filename.lastIndexOf('/') + 1);
  const assets = new Map<bigint, AudioBuffer>();
  const bindings: Sample_Binding_Values[] = [];
  const warnings: string[] = [];
  const resolved = new Map<string, bigint>();
  const retained_buffers = new Map<AudioBuffer, bigint>();
  const check_active = () => require_condition(!cancelled(), 'CANCELLED', 'Sample loading was cancelled.');
  for (const sample of descriptor.sample_candidates()) {
    check_active();
    let available = false;
    for (let candidate_index = 0; candidate_index < sample.candidates.length; candidate_index++) {
      const candidate = sample.candidates[candidate_index];
      const key = `${sample.use_beatmap}:${candidate}`;
      if (!resolved.has(key)) {
        require_condition(resolved.size < maximum_assets, 'QUOTA_EXCEEDED', 'Sample candidate limit exceeded.');
        let buffer: AudioBuffer | null = null;
        if (sample.use_beatmap) {
          const filename = candidate.startsWith('Gameplay/') ? candidate.slice('Gameplay/'.length) : candidate;
          for (const extension of probe_extensions) {
            check_active();
            const path = normalize_asset_path(directory + filename + extension);
            const encoded = await source.read(path);
            check_active();
            if (!encoded) continue;
            try {
              buffer = await source.decode_music(path, encoded, decode_audio);
            } catch (error) {
              if (error instanceof Browser_Error && ['QUOTA_EXCEEDED', 'DISPOSED', 'CANCELLED'].includes(error.code)) throw error;
              warnings.push(`Could not decode hitsound: ${path}`);
            }
            check_active();
            if (buffer) break;
          }
        }
        buffer ??= fallback_assets.get(candidate) ?? null;
        let asset_id = 0n;
        if (buffer) {
          asset_id = retained_buffers.get(buffer) ?? 0n;
          if (asset_id === 0n) {
            require_condition(assets.size < maximum_assets, 'QUOTA_EXCEEDED', 'Decoded sample asset limit exceeded.');
            asset_id = BigInt(assets.size + 1);
            retained_buffers.set(buffer, asset_id);
            assets.set(asset_id, buffer);
          }
        }
        resolved.set(key, asset_id);
      }
      const asset_id = resolved.get(key)!;
      available ||= asset_id !== 0n;
      require_condition(bindings.length < maximum_bindings, 'QUOTA_EXCEEDED', 'Sample binding limit exceeded.');
      bindings.push({ object_id: sample.object_id, component_id: sample.component_id,
        sample_index: sample.sample_index, candidate_index, asset_id });
    }
    if (!available) warnings.push(`Missing hitsound: object ${sample.object_id}, ${sample.name}`);
  }
  check_active();
  return { assets, bindings, warnings };
}

export function bind_sample_assets(engine: Engine_Bridge, session_handle: bigint, samples: Loaded_Samples) {
  for (const binding of samples.bindings) engine.bind_sample(session_handle, binding);
}
