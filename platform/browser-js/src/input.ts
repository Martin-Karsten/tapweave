import { all_finite, require_condition } from './errors.js';
import { INPUT_STAGING_RECORDS } from './abi-records.js';

export const ACTION = Object.freeze({ LEFT: 1, RIGHT: 2 });

export interface Input_Snapshot {
  sequence: bigint;
  // Authoritative judgement stamp: AudioContext seconds captured at receipt.
  audio_seconds: number;
  // Browser clock epoch at receipt; drain rejects closed-epoch records.
  clock_epoch: number;
  // performance.now() at receipt, retained for diagnostics only.
  raw_time_ms: number;
  x: number;
  y: number;
  action_bits: number;
  source: string;
  focus_epoch: number;
  flags?: number;
}

export interface Input_Receive {
  source_id: string;
  action?: number;
  held?: boolean;
  audio_seconds: number;
  clock_epoch: number;
  raw_time_ms?: number;
  client_x?: number;
  client_y?: number;
  inverse_transform?: number[];
}

// Browser resources only: inverse coefficients come from Odin presentation.
export class Input_Buffer {
  maximum_records: number;
  records: Input_Snapshot[] = [];
  held_sources = new Map<string, number>();
  sequence = 0n;
  focus_epoch = 0;
  // osu! playfield center on the 512 x 384 board.
  x = 256;
  y = 192;

  constructor(maximum_records = INPUT_STAGING_RECORDS) {
    require_condition(Number.isSafeInteger(maximum_records) && maximum_records > 0,
      'INVALID_ARGUMENT', 'Invalid input queue capacity.');
    this.maximum_records = maximum_records;
  }

  reconcile(sources: ReadonlyMap<string, number>, audio_seconds: number, clock_epoch: number, flags = 0, position?: { x: number; y: number }) {
    require_condition(this.records.length < this.maximum_records && Number.isFinite(audio_seconds) &&
      Number.isInteger(clock_epoch) && clock_epoch >= 0 && (flags === 0 || flags === 1) && (!position || all_finite([position.x, position.y])) &&
      [...sources.values()].every(action => action === ACTION.LEFT || action === ACTION.RIGHT),
    'INVALID_INPUT', 'Invalid resume input state.');
    this.held_sources = new Map(sources);
    if (position) { this.x = position.x; this.y = position.y; }
    let action_bits = 0;
    for (const action of sources.values()) action_bits |= action;
    this.records.push({ sequence: ++this.sequence, audio_seconds, clock_epoch, raw_time_ms: performance.now(),
      x: this.x, y: this.y, action_bits, source: 'resume', focus_epoch: this.focus_epoch, flags });
  }

  receive({ source_id, action = 0, held = false, audio_seconds, clock_epoch, raw_time_ms,
    client_x, client_y, inverse_transform }: Input_Receive) {
    require_condition(this.records.length < this.maximum_records, 'QUOTA_EXCEEDED', 'Input queue is full.');
    require_condition(Number.isFinite(audio_seconds) && Number.isInteger(clock_epoch) && clock_epoch >= 0 &&
      (raw_time_ms === undefined || Number.isFinite(raw_time_ms)) &&
      [0, ACTION.LEFT, ACTION.RIGHT].includes(action) &&
      typeof source_id === 'string' && typeof held === 'boolean', 'INVALID_INPUT', 'Invalid input snapshot.');
    let x = this.x;
    let y = this.y;
    if (client_x !== undefined || client_y !== undefined) {
      const transform = inverse_transform ?? [];
      require_condition(inverse_transform?.length === 6 && all_finite([client_x, client_y, ...transform]),
        'INVALID_INPUT', 'Invalid input transform.');
      x = transform[0] * client_x! + transform[2] * client_y! + transform[4];
      y = transform[1] * client_x! + transform[3] * client_y! + transform[5];
      require_condition(Number.isFinite(x) && Number.isFinite(y), 'INVALID_INPUT', 'Input transform overflow.');
    }
    if (action !== 0) {
      if (held) {
        this.held_sources.set(source_id, action);
      } else {
        this.held_sources.delete(source_id);
      }
    }
    this.x = x;
    this.y = y;
    let action_bits = 0;
    for (const held_action of this.held_sources.values()) {
      action_bits |= held_action;
    }
    this.records.push({ sequence: ++this.sequence, audio_seconds, clock_epoch,
      raw_time_ms: raw_time_ms ?? audio_seconds * 1000, x, y, action_bits, source: source_id,
      focus_epoch: this.focus_epoch });
  }

  release_all(audio_seconds: number, clock_epoch: number, raw_time_ms?: number) {
    require_condition(Number.isFinite(audio_seconds) && Number.isInteger(clock_epoch) && clock_epoch >= 0 &&
      (raw_time_ms === undefined || Number.isFinite(raw_time_ms)) && this.records.length < this.maximum_records,
      'INVALID_INPUT', 'Cannot append release-all input.');
    this.held_sources.clear();
    this.focus_epoch++;
    this.records.push({ sequence: ++this.sequence, audio_seconds, clock_epoch,
      raw_time_ms: raw_time_ms ?? audio_seconds * 1000, x: this.x, y: this.y,
      action_bits: 0, source: 'release_all', focus_epoch: this.focus_epoch });
  }

  flush(submit: (records: Input_Snapshot[]) => void) {
    // A rejected submission retains every record for explicit recovery.
    submit(this.records);
    this.records.length = 0;
  }
}
