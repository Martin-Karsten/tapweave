import { Archive_Assets, Loose_Assets, ASSET_LIMITS, normalize_asset_path } from './archive.mjs';
import { require_condition } from './errors.mjs';

export class Selection_Controller {
  constructor(engine, { decode_audio = null, on_change = () => {}, limits = ASSET_LIMITS } = {}) {
    this.engine = engine;
    this.decode_audio = decode_audio;
    this.on_change = on_change;
    this.limits = limits;
    this.generation = 0;
    this.active = null;
    this.pending_candidate = null;
    this.disposed = false;
    this.state = 'empty';
    this.error = null;
  }

  async load_files(files) {
    require_condition(!this.disposed, 'DISPOSED', 'Player is disposed.');
    const generation = ++this.generation;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
    this.on_change(this);
    let source;
    try {
      const archives = files.filter(file => file.name.toLowerCase().endsWith('.osz'));
      if (archives.length > 0) {
        require_condition(files.length === 1, 'INVALID_SELECTION', 'Select one archive or a beatmap with its loose assets.');
        require_condition(archives[0].size <= this.limits.archive_bytes, 'QUOTA_EXCEEDED', 'Archive exceeds the input quota.');
        const archive_bytes = new Uint8Array(await archives[0].arrayBuffer());
        if (generation !== this.generation || this.disposed) {
          return;
        }
        source = new Archive_Assets(archive_bytes, this.limits);
      } else {
        source = new Loose_Assets(files, this.limits);
      }
      if (generation !== this.generation || this.disposed) {
        source.dispose();
        return;
      }
      const maps = source.list_maps();
      require_condition(maps.length > 0, 'MISSING_MAP', 'No .osu difficulty was found.');
      await this.prepare_candidate(source, maps[0], generation);
    } catch (error) {
      if (source && source !== this.active?.source) {
        source.dispose();
      }
      this.report_failure(error, generation);
    }
  }

  async select_map(filename) {
    require_condition(this.active && !this.disposed, 'INVALID_STATE', 'Load a beatmap set first.');
    const generation = ++this.generation;
    this.release_candidate(this.pending_candidate);
    this.state = 'loading';
    this.error = null;
    this.on_change(this);
    try {
      await this.prepare_candidate(this.active.source, filename, generation);
    } catch (error) {
      this.report_failure(error, generation);
    }
  }

  async prepare_candidate(source, filename, generation) {
    const candidate = { source, prepared_map: null, released: false };
    this.pending_candidate = candidate;
    try {
      const bytes = await source.read(filename);
      if (generation !== this.generation || this.disposed) {
        return;
      }
      require_condition(bytes !== null, 'MISSING_MAP', 'Selected beatmap is missing.');
      candidate.prepared_map = this.engine.prepare_map(bytes);
      const audio_filename = candidate.prepared_map.descriptor.audio_filename;
      const map_directory = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
      const audio_path = audio_filename ? normalize_asset_path(map_directory + audio_filename) : null;
      const audio_bytes = audio_path ? await source.read(audio_path) : null;
      if (generation !== this.generation || this.disposed) {
        return;
      }
      let music_buffer = null;
      let music_error = audio_bytes ? null : 'Main music is missing. Production start requires music.';
      if (audio_bytes && this.decode_audio) {
        try {
          music_buffer = await source.decode_music(audio_path, audio_bytes, this.decode_audio);
        } catch (error) {
          if (error.code === 'QUOTA_EXCEEDED') {
            throw error;
          }
          music_buffer = null;
          music_error = 'Music could not be decoded by this browser.';
        }
      }
      if (generation !== this.generation || this.disposed) {
        return;
      }
      const previous = this.active;
      this.active = { source, filename, ...candidate.prepared_map, music_buffer, music_error,
        music_status: music_buffer ? 'decoded' : audio_bytes ? 'available' : 'missing' };
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

  release_candidate(candidate) {
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

  report_failure(error, generation) {
    if (generation === this.generation && !this.disposed) {
      this.state = this.active ? 'prepared' : 'empty';
      this.error = error;
      this.on_change(this);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation++;
    this.release_candidate(this.pending_candidate);
    if (this.active) {
      this.engine.release_map(this.active.map_handle);
      this.active.source.dispose();
      this.active = null;
    }
    this.state = 'disposed';
  }
}
