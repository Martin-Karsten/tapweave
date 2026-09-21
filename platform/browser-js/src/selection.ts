import { Archive_Assets, Loose_Assets, ASSET_LIMITS, normalize_asset_path, type Asset_Limits, type Asset_Scope } from './archive.js';
import { require_condition, Browser_Error } from './errors.js';
import { Audio_Decoder, type Decode_Audio } from './audio-decoder.js';
import { load_sample_assets, type Loaded_Samples } from './sample-assets.js';
import { map_summary_of, type Map_Summary } from './map-summary.js';
import type { Create_Audio_Buffer } from './wav-fallback.js';
import type { Engine_Bridge, Prepared_Description } from './engine-bridge.js';

export interface Prepared_Map {
  map_handle: bigint;
  descriptor: Prepared_Description;
}

export interface Active_Selection extends Prepared_Map {
  source: Asset_Scope;
  filename: string;
  music_buffer: AudioBuffer | null;
  music_error: string | null;
  samples: Loaded_Samples | null;
  music_status: 'decoded' | 'available' | 'missing';
}

export interface Selection_Candidate {
  source: Asset_Scope;
  prepared_map: Prepared_Map | null;
  released: boolean;
}

// Optional admission checks run before publishing or releasing the old map.
export interface Selection_Request {
  choose_map?: (source: Asset_Scope) => Promise<string>;
  validate?: (candidate: Active_Selection) => Promise<void>;
}

export interface Selection_Options {
  decode_audio?: Decode_Audio | null;
  // Optional in-house PCM/WAVE fallback for encodings the browser decoder
  // rejects; needs a factory that creates AudioBuffer instances.
  create_buffer?: Create_Audio_Buffer | null;
  on_change?: (controller: Selection_Controller) => void;
  on_summaries_change?: (controller: Selection_Controller) => void;
  limits?: Asset_Limits;
  fallback_assets?: Map<string, AudioBuffer>;
  // Background summaries run on their own engine instance so the passes never
  // replace the gameplay engine's dedicated input inbox.
  summary_engine_factory?: (() => Promise<Engine_Bridge>) | null;
}

export class Selection_Controller {
  engine: Engine_Bridge;
  fallback_assets: Map<string, AudioBuffer>;
  audio_decoder: Audio_Decoder | null;
  decode_audio: Decode_Audio | null;
  on_change: (controller: Selection_Controller) => void;
  on_summaries_change: (controller: Selection_Controller) => void;
  limits: Asset_Limits;
  generation = 0;
  active: Active_Selection | null = null;
  pending_candidate: Selection_Candidate | null = null;
  disposed = false;
  state: 'empty' | 'loading' | 'prepared' | 'disposed' = 'empty';
  error: Browser_Error | null = null;
  summaries = new Map<string, Map_Summary>();
  summary_failures = new Map<string, string>();
  private summary_engine: Engine_Bridge | null = null;
  private summary_engine_factory: (() => Promise<Engine_Bridge>) | null;
  private summary_work: Promise<void> | null = null;
  private scope_generation = 0;

  constructor(engine: Engine_Bridge, { decode_audio = null, create_buffer = null, on_change = () => {},
    on_summaries_change = () => {}, limits = ASSET_LIMITS, fallback_assets = new Map<string, AudioBuffer>(),
    summary_engine_factory = null }: Selection_Options = {}) {
    this.engine = engine;
    this.fallback_assets = fallback_assets;
    this.audio_decoder = decode_audio ? new Audio_Decoder(decode_audio, { create_buffer }) : null;
    this.decode_audio = this.audio_decoder ? bytes => this.audio_decoder!.decode(bytes as Uint8Array) : null;
    this.on_change = on_change;
    this.on_summaries_change = on_summaries_change;
    this.limits = limits;
    this.summary_engine_factory = summary_engine_factory;
  }

  async load_files(files: File[], request: Selection_Request = {}) {
    require_condition(!this.disposed, 'DISPOSED', 'Player is disposed.');
    const generation = ++this.generation;
    this.scope_generation++;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
    // A new scope invalidates every cached difficulty summary.
    this.summaries.clear();
    this.summary_failures.clear();
    this.on_change(this);
    let source: Asset_Scope | null = null;
    try {
      const archives = files.filter(file => file.name.toLowerCase().endsWith('.osz'));
      if (archives.length > 0) {
        require_condition(files.length === 1, 'INVALID_SELECTION', 'Select one archive or a beatmap with its loose assets.');
        require_condition(archives[0].size <= this.limits.archive_bytes, 'QUOTA_EXCEEDED', 'Archive exceeds the input quota.');
        const archive_bytes = new Uint8Array(await archives[0].arrayBuffer());
        if (this.is_stale(generation)) {
          return;
        }
        source = new Archive_Assets(archive_bytes, this.limits);
      } else {
        source = new Loose_Assets(files, this.limits);
      }
      if (this.is_stale(generation)) {
        source.dispose();
        return;
      }
      const maps = source.list_maps();
      require_condition(maps.length > 0, 'MISSING_MAP', 'No .osu difficulty was found.');
      const filename = request.choose_map ? await request.choose_map(source) : maps[0];
      if (this.is_stale(generation)) {
        source.dispose();
        return;
      }
      await this.prepare_candidate(source, filename, generation, request);
    } catch (error) {
      if (source && source !== this.active?.source) {
        source.dispose();
      }
      this.report_failure(error, generation);
    }
  }

  async select_map(filename: string, request: Selection_Request = {}) {
    require_condition(this.active && !this.disposed, 'INVALID_STATE', 'Load a beatmap set first.');
    const generation = ++this.generation;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
    this.on_change(this);
    try {
      await this.prepare_candidate(this.active!.source, filename, generation, request);
    } catch (error) {
      this.report_failure(error, generation);
    }
  }

  async prepare_candidate(source: Asset_Scope, filename: string, generation: number, request: Selection_Request = {}) {
    const candidate: Selection_Candidate = { source, prepared_map: null, released: false };
    this.pending_candidate = candidate;
    try {
      const bytes = await source.read(filename);
      if (this.is_stale(generation)) {
        return;
      }
      require_condition(bytes !== null, 'MISSING_MAP', 'Selected beatmap is missing.');
      try {
        candidate.prepared_map = this.engine.prepare_map(bytes);
      } catch (error) {
        // Engine rejections keep the attempted difficulty name so surfaces can
        // explain which map refused to load (for example non-standard rulesets).
        if (error instanceof Browser_Error) {
          error.details = { ...error.details, filename };
        }
        throw error;
      }
      const audio_filename = candidate.prepared_map.descriptor.audio_filename;
      const map_directory = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
      const audio_path = audio_filename ? normalize_asset_path(map_directory + audio_filename) : null;
      const audio_bytes = audio_path ? await source.read(audio_path) : null;
      if (this.is_stale(generation)) {
        return;
      }
      let music_buffer: AudioBuffer | null = null;
      let music_error: string | null = audio_bytes ? null : 'Main music is missing. Production start requires music.';
      if (audio_bytes && this.decode_audio) {
        try {
          music_buffer = await source.decode_music(audio_path!, audio_bytes, this.decode_audio);
        } catch (error) {
          if (error instanceof Browser_Error && error.code === 'QUOTA_EXCEEDED') {
            throw error;
          }
          music_buffer = null;
          music_error = 'Music could not be decoded by this browser.';
        }
      }
      if (this.is_stale(generation)) {
        return;
      }
      const samples = this.decode_audio !== null && candidate.prepared_map.descriptor.sample_candidates !== undefined ?
        await load_sample_assets(candidate.prepared_map.descriptor, source, filename, this.decode_audio,
          this.engine.sample_probe(), {
            fallback_assets: this.fallback_assets, cancelled: () => this.is_stale(generation),
          }) : null;
      if (this.is_stale(generation)) return;
      const prepared_selection: Active_Selection = {
        source,
        filename,
        ...candidate.prepared_map,
        music_buffer,
        music_error,
        samples,
        music_status: music_buffer ? 'decoded' : audio_bytes ? 'available' : 'missing',
      };
      await request.validate?.(prepared_selection);
      if (this.is_stale(generation)) {
        return;
      }
      const previous = this.active;
      this.active = prepared_selection;
      candidate.prepared_map = null;
      this.state = 'prepared';
      this.error = null;
      if (previous) {
        this.engine.release_map(previous.map_handle);
        if (previous.source !== source) {
          previous.source.dispose();
        }
      }
      this.on_change(this);
    } finally {
      this.release_candidate(candidate);
    }
  }

  cancel_pending() {
    if (this.state !== 'loading' || this.disposed) {
      return;
    }
    this.generation++;
    this.release_candidate(this.pending_candidate);
    this.state = this.active ? 'prepared' : 'empty';
    this.error = null;
    this.on_change(this);
  }

  release_candidate(candidate: Selection_Candidate | null) {
    if (!candidate || candidate.released) {
      return;
    }
    candidate.released = true;
    if (candidate.prepared_map) {
      this.engine.release_map(candidate.prepared_map.map_handle);
      candidate.prepared_map = null;
    }
    if (candidate.source !== this.active?.source) {
      candidate.source.dispose();
    }
    if (this.pending_candidate === candidate) {
      this.pending_candidate = null;
    }
  }

  report_failure(error: unknown, generation: number) {
    if (generation === this.generation && !this.disposed) {
      this.state = this.active ? 'prepared' : 'empty';
      this.error = error as Browser_Error;
      this.on_change(this);
    }
  }

  // A load started under an older generation, or the controller was disposed.
  is_stale(generation: number) {
    return generation !== this.generation || this.disposed;
  }

  // Describe every difficulty in the loaded scope that has no cached summary
  // yet. The pass runs one file at a time on the dedicated summary engine, so
  // it never replaces the gameplay engine's input inbox; one failing
  // difficulty is recorded and skipped without touching selection state.
  // Concurrent callers await the running pass instead of starting a second.
  describe_summaries(): Promise<void> {
    if (this.summary_work) {
      return this.summary_work;
    }
    const work = this.run_summary_pass();
    this.summary_work = work;
    return work.finally(() => {
      if (this.summary_work === work) {
        this.summary_work = null;
      }
    });
  }

  private async run_summary_pass(): Promise<void> {
    const source = this.active?.source;
    if (!source || !this.summary_engine_factory || this.disposed) {
      return;
    }
    const scope = this.scope_generation;
    if (!this.summary_engine) {
      this.summary_engine = await this.summary_engine_factory();
      if (scope !== this.scope_generation || this.disposed) {
        return;
      }
    }
    let changed = false;
    for (const filename of source.list_maps()) {
      if (scope !== this.scope_generation || this.disposed) {
        break;
      }
      if (this.summaries.has(filename) || this.summary_failures.has(filename)) {
        continue;
      }
      try {
        const bytes = await source.read(filename);
        if (scope !== this.scope_generation || this.disposed) {
          break;
        }
        require_condition(bytes !== null, 'MISSING_MAP', 'Selected beatmap is missing.');
        const { map_handle, descriptor } = this.summary_engine.prepare_map_foundation(bytes);
        this.summaries.set(filename, map_summary_of(filename, descriptor));
        this.summary_engine.release_map(map_handle);
      } catch (error) {
        this.summary_failures.set(filename, error instanceof Error ? error.message : String(error));
      }
      changed = true;
      this.on_summaries_change(this);
    }
    if (changed) {
      this.on_summaries_change(this);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation++;
    this.scope_generation++;
    this.release_candidate(this.pending_candidate);
    if (this.active) {
      this.engine.release_map(this.active.map_handle);
      this.active.source.dispose();
      this.active = null;
    }
    this.summaries.clear();
    this.summary_failures.clear();
    if (this.summary_engine) {
      this.summary_engine.dispose();
      this.summary_engine = null;
    }
    this.state = 'disposed';
  }
}
