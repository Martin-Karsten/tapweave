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

// One imported beatmap set of the session library. Sets stay loaded until the
// user removes them; each owns its scope's lifetime and its per-difficulty
// background summaries.
export interface Loaded_Set {
  set_id: number;
  source: Asset_Scope;
  summaries: Map<string, Map_Summary>;
  summary_failures: Map<string, string>;
}

export interface Active_Selection extends Prepared_Map {
  set_id: number;
  source: Asset_Scope;
  filename: string;
  music_buffer: AudioBuffer | null;
  music_error: string | null;
  samples: Loaded_Samples | null;
  music_status: 'decoded' | 'available' | 'missing';
}

export interface Selection_Candidate {
  set_id: number;
  source: Asset_Scope;
  prepared_map: Prepared_Map | null;
  released: boolean;
}

// A difficulty located by content hash across the whole session library;
// multiplayer guests match the host's choice without re-importing.
export interface Map_Hash_Match {
  set_id: number;
  filename: string;
}

// Optional admission checks run before publishing or releasing the old map.
export interface Selection_Request {
  choose_map?: (source: Asset_Scope) => Promise<string>;
  validate?: (candidate: Active_Selection) => Promise<void>;
}

// Session-library admission limits on top of each scope's own quotas: the
// retained cost of a set is its archive payload (loose sets hold File refs),
// so the byte budget bounds compressed archives only.
const DEFAULT_MAX_LOADED_SETS = 12;
const DEFAULT_MAX_TOTAL_LIBRARY_BYTES = 2 * ASSET_LIMITS.archive_bytes;

export interface Selection_Options {
  decode_audio?: Decode_Audio | null;
  // Optional in-house PCM/WAVE fallback for encodings the browser decoder
  // rejects; needs a factory that creates AudioBuffer instances.
  create_buffer?: Create_Audio_Buffer | null;
  on_change?: (controller: Selection_Controller) => void;
  on_summaries_change?: (controller: Selection_Controller) => void;
  limits?: Asset_Limits;
  fallback_assets?: Map<string, AudioBuffer>;
  // Background summaries run on their own engine instance so the gameplay
  // engine's dedicated input inbox is never replaced.
  summary_engine_factory?: (() => Promise<Engine_Bridge>) | null;
  max_loaded_sets?: number;
  max_total_library_bytes?: number;
}

// Archive sets retain their compressed payload for the whole session; loose
// sets retain File references that the browser backs outside the heap.
function retained_source_bytes(source: Asset_Scope): number {
  return source instanceof Archive_Assets && source.bytes !== null ? source.bytes.byteLength : 0;
}

export class Selection_Controller {
  engine: Engine_Bridge;
  fallback_assets: Map<string, AudioBuffer>;
  audio_decoder: Audio_Decoder | null;
  decode_audio: Decode_Audio | null;
  on_change: (controller: Selection_Controller) => void;
  on_summaries_change: (controller: Selection_Controller) => void;
  limits: Asset_Limits;
  max_loaded_sets: number;
  max_total_library_bytes: number;
  generation = 0;
  next_set_id = 1;
  loaded_sets: Loaded_Set[] = [];
  active: Active_Selection | null = null;
  pending_candidate: Selection_Candidate | null = null;
  disposed = false;
  state: 'empty' | 'loading' | 'prepared' | 'disposed' = 'empty';
  error: Browser_Error | null = null;
  private summary_engine: Engine_Bridge | null = null;
  private summary_engine_factory: (() => Promise<Engine_Bridge>) | null;
  private summary_work: Promise<void> | null = null;
  private library_generation = 0;

  constructor(engine: Engine_Bridge, { decode_audio = null, create_buffer = null, on_change = () => {},
    on_summaries_change = () => {}, limits = ASSET_LIMITS, fallback_assets = new Map<string, AudioBuffer>(),
    summary_engine_factory = null, max_loaded_sets = DEFAULT_MAX_LOADED_SETS,
    max_total_library_bytes = DEFAULT_MAX_TOTAL_LIBRARY_BYTES }: Selection_Options = {}) {
    this.engine = engine;
    this.fallback_assets = fallback_assets;
    this.audio_decoder = decode_audio ? new Audio_Decoder(decode_audio, { create_buffer }) : null;
    this.decode_audio = this.audio_decoder ? bytes => this.audio_decoder!.decode(bytes as Uint8Array) : null;
    this.on_change = on_change;
    this.on_summaries_change = on_summaries_change;
    this.limits = limits;
    this.summary_engine_factory = summary_engine_factory;
    this.max_loaded_sets = max_loaded_sets;
    this.max_total_library_bytes = max_total_library_bytes;
  }

  loaded_set_by_id(set_id: number): Loaded_Set | null {
    return this.loaded_sets.find(loaded_set => loaded_set.set_id === set_id) ?? null;
  }

  retained_library_bytes(): number {
    let total_bytes = 0;
    for (const loaded_set of this.loaded_sets) {
      total_bytes += retained_source_bytes(loaded_set.source);
    }
    return total_bytes;
  }

  // Add an imported archive or loose file group as a new library set and
  // select a difficulty inside it. The previous selection and every existing
  // set survive a failed import: the new scope is published only after its
  // difficulty prepared (and any request.validate passed), otherwise it is
  // disposed without touching standing state.
  async add_files(files: File[], request: Selection_Request = {}) {
    require_condition(!this.disposed, 'DISPOSED', 'Player is disposed.');
    const generation = ++this.generation;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
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
      require_condition(this.loaded_sets.length < this.max_loaded_sets,
        'QUOTA_EXCEEDED', `At most ${this.max_loaded_sets} beatmap sets can stay loaded.`);
      require_condition(this.retained_library_bytes() + retained_source_bytes(source) <= this.max_total_library_bytes,
        'QUOTA_EXCEEDED', 'The loaded beatmap sets exceed the session library quota.');
      const filename = request.choose_map ? await request.choose_map(source) : maps[0];
      if (this.is_stale(generation)) {
        source.dispose();
        return;
      }
      const added_set: Loaded_Set = { set_id: this.next_set_id++, source,
        summaries: new Map<string, Map_Summary>(), summary_failures: new Map<string, string>() };
      this.loaded_sets.push(added_set);
      this.library_generation++;
      await this.prepare_candidate(added_set.set_id, source, filename, generation, request);
    } catch (error) {
      // The failed set never became part of the library: remove the appended
      // record (if the failure hit after admission) and dispose its scope.
      if (source) {
        const added_set_index = this.loaded_sets.findIndex(loaded_set => loaded_set.source === source);
        if (added_set_index >= 0) {
          this.loaded_sets.splice(added_set_index, 1);
          this.library_generation++;
        }
        source.dispose();
      }
      this.report_failure(error, generation);
    }
  }

  async select_map(set_id: number, filename: string, request: Selection_Request = {}) {
    require_condition(!this.disposed, 'DISPOSED', 'Player is disposed.');
    const target_set = this.loaded_set_by_id(set_id);
    require_condition(target_set !== null, 'INVALID_SELECTION', 'That beatmap set is no longer loaded.');
    require_condition(target_set.source.list_maps().includes(filename), 'INVALID_SELECTION', 'Selected difficulty is missing.');
    const generation = ++this.generation;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
    this.on_change(this);
    try {
      await this.prepare_candidate(target_set.set_id, target_set.source, filename, generation, request);
    } catch (error) {
      this.report_failure(error, generation);
    }
  }

  // Remove one library set. Removing the active set first prepares a
  // successor from a neighbouring set (publish-only-after-success), then
  // disposes the removed scope; a failed successor selection re-inserts the
  // removed set so the previous selection stays valid.
  async remove_set(set_id: number, request: Selection_Request = {}) {
    require_condition(!this.disposed, 'DISPOSED', 'Player is disposed.');
    require_condition(this.state !== 'loading', 'INVALID_STATE', 'A selection change is already in progress.');
    const removed_set = this.loaded_set_by_id(set_id);
    require_condition(removed_set !== null, 'INVALID_SELECTION', 'That beatmap set is not loaded.');
    const removed_index = this.loaded_sets.indexOf(removed_set);
    if (!this.active || this.active.set_id !== set_id) {
      this.loaded_sets.splice(removed_index, 1);
      this.library_generation++;
      removed_set.source.dispose();
      this.on_change(this);
      return;
    }
    const generation = ++this.generation;
    this.library_generation++;
    this.release_candidate(this.pending_candidate);
    const remaining_sets = this.loaded_sets.filter(loaded_set => loaded_set.set_id !== set_id);
    if (remaining_sets.length === 0) {
      const previous = this.active;
      this.active = null;
      this.loaded_sets = [];
      this.state = 'empty';
      this.error = null;
      this.engine.release_map(previous.map_handle);
      // The removed set owns the active scope; one disposal covers both.
      removed_set.source.dispose();
      this.on_change(this);
      return;
    }
    const successor_set = remaining_sets[Math.min(removed_index, remaining_sets.length - 1)];
    this.loaded_sets = remaining_sets;
    this.state = 'loading';
    this.error = null;
    this.on_change(this);
    try {
      const maps = successor_set.source.list_maps();
      const filename = request.choose_map ? await request.choose_map(successor_set.source) : maps[0];
      require_condition(maps.length > 0 && filename !== undefined, 'MISSING_MAP', 'The next beatmap set has no difficulties.');
      await this.prepare_candidate(successor_set.set_id, successor_set.source, filename, generation, request);
      removed_set.source.dispose();
    } catch (error) {
      this.loaded_sets.splice(Math.min(removed_index, this.loaded_sets.length), 0, removed_set);
      this.report_failure(error, generation);
    }
  }

  // Locate the difficulty whose exact bytes hash to the expected value across
  // every loaded set. Hashing is injected so this module stays crypto-free.
  async find_map_by_hash(hash_bytes: (bytes: Uint8Array) => Promise<string>,
    expected_map_hash: string): Promise<Map_Hash_Match | null> {
    for (const loaded_set of this.loaded_sets) {
      for (const filename of loaded_set.source.list_maps()) {
        const bytes = await loaded_set.source.read(filename);
        if (bytes && (await hash_bytes(bytes)) === expected_map_hash) {
          return { set_id: loaded_set.set_id, filename };
        }
      }
    }
    return null;
  }

  async prepare_candidate(set_id: number, source: Asset_Scope, filename: string, generation: number,
    request: Selection_Request = {}) {
    const candidate: Selection_Candidate = { set_id, source, prepared_map: null, released: false };
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
        set_id,
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
      // The replaced map handle is released here; its scope stays owned by its
      // library set and only set removal disposes scopes.
      if (previous) {
        this.engine.release_map(previous.map_handle);
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
    // Candidate scopes belong to library sets; only set removal disposes them.
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

  // Describe every difficulty across the loaded sets that has no cached
  // summary yet. The pass runs one file at a time on the dedicated summary
  // engine, so it never replaces the gameplay engine's input inbox; one
  // failing difficulty is recorded and skipped without touching selection
  // state. Concurrent callers await the running pass instead of starting a
  // second one.
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
    if (this.loaded_sets.length === 0 || !this.summary_engine_factory || this.disposed) {
      return;
    }
    const library_generation = this.library_generation;
    if (!this.summary_engine) {
      this.summary_engine = await this.summary_engine_factory();
      if (library_generation !== this.library_generation || this.disposed) {
        return;
      }
    }
    let changed = false;
    for (const loaded_set of this.loaded_sets) {
      for (const filename of loaded_set.source.list_maps()) {
        if (library_generation !== this.library_generation || this.disposed) {
          return;
        }
        if (loaded_set.summaries.has(filename) || loaded_set.summary_failures.has(filename)) {
          continue;
        }
        try {
          const bytes = await loaded_set.source.read(filename);
          if (library_generation !== this.library_generation || this.disposed) {
            return;
          }
          require_condition(bytes !== null, 'MISSING_MAP', 'Selected beatmap is missing.');
          const { map_handle, descriptor } = this.summary_engine.prepare_map_foundation(bytes);
          loaded_set.summaries.set(filename, map_summary_of(filename, descriptor));
          this.summary_engine.release_map(map_handle);
        } catch (error) {
          loaded_set.summary_failures.set(filename, error instanceof Error ? error.message : String(error));
        }
        changed = true;
        this.on_summaries_change(this);
      }
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
    this.library_generation++;
    this.release_candidate(this.pending_candidate);
    if (this.active) {
      this.engine.release_map(this.active.map_handle);
      this.active = null;
    }
    for (const loaded_set of this.loaded_sets) {
      loaded_set.source.dispose();
    }
    this.loaded_sets = [];
    if (this.summary_engine) {
      this.summary_engine.dispose();
      this.summary_engine = null;
    }
    this.state = 'disposed';
  }
}
