import { require_condition } from './errors.mjs';
import { normalize_asset_path } from './archive.mjs';

// Resource lookup only: every available candidate is bound independently.
// The engine, never this loader, selects the first available prepared candidate.
export async function load_sample_assets(descriptor, source, map_filename, decode_audio,
  { fallback_assets = new Map(), maximum_assets = 4096, maximum_bindings = 1_000_000, cancelled = () => false } = {}) {
  require_condition(typeof decode_audio === 'function' && Number.isSafeInteger(maximum_assets) && maximum_assets > 0 && Number.isSafeInteger(maximum_bindings) && maximum_bindings > 0,
    'INVALID_ARGUMENT', 'A decoder and positive sample asset limit are required.');
  const directory = map_filename.slice(0, map_filename.lastIndexOf('/') + 1);
  const assets = new Map();
  const bindings = [];
  const warnings = [];
  const resolved = new Map();
  const retained_buffers = new Map();
  const check_active = () => require_condition(!cancelled(), 'CANCELLED', 'Sample loading was cancelled.');
  for (const sample of descriptor.sample_candidates()) {
    check_active();
    let available = false;
    for (let candidate_index = 0; candidate_index < sample.candidates.length; candidate_index++) {
      const candidate = sample.candidates[candidate_index];
      const key = `${sample.use_beatmap}:${candidate}`;
      if (!resolved.has(key)) {
        require_condition(resolved.size < maximum_assets, 'QUOTA_EXCEEDED', 'Sample candidate limit exceeded.');
        let buffer = null;
        if (sample.use_beatmap) {
          const filename = candidate.startsWith('Gameplay/') ? candidate.slice('Gameplay/'.length) : candidate;
          // Pinned Skin/SampleStore extension priority: exact, wav, mp3, ogg.
          for (const extension of ['', '.wav', '.mp3', '.ogg']) {
            check_active();
            const path = normalize_asset_path(directory + filename + extension);
            const encoded = await source.read(path);
            check_active();
            if (!encoded) continue;
            try {
              buffer = await source.decode_music(path, encoded, decode_audio);
            } catch (error) {
              if (['QUOTA_EXCEEDED', 'DISPOSED', 'CANCELLED'].includes(error.code)) throw error;
              warnings.push(`Could not decode hitsound: ${path}`);
            }
            check_active();
            if (buffer) break;
          }
        }
        buffer ??= fallback_assets.get(candidate) ?? null;
        let asset_id = 0n;
        if (buffer) {
          asset_id = retained_buffers.get(buffer);
          if (asset_id === undefined) {
            require_condition(assets.size < maximum_assets, 'QUOTA_EXCEEDED', 'Decoded sample asset limit exceeded.');
            asset_id = BigInt(assets.size + 1);
            retained_buffers.set(buffer, asset_id);
            assets.set(asset_id, buffer);
          }
        }
        resolved.set(key, asset_id);
      }
      const asset_id = resolved.get(key);
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

export function bind_sample_assets(engine, session_handle, samples) {
  for (const binding of samples.bindings) engine.bind_sample(session_handle, binding);
}
