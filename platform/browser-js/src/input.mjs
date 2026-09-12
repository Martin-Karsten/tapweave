import { require_condition } from './errors.mjs';

export const ACTION = Object.freeze({ LEFT: 1, RIGHT: 2 });

// Browser resources only: inverse coefficients come from Odin presentation.
export class Input_Buffer {
  constructor(maximum_records = 8192) {
    require_condition(Number.isSafeInteger(maximum_records) && maximum_records > 0,
      'INVALID_ARGUMENT', 'Invalid input queue capacity.');
    this.maximum_records = maximum_records;
    this.records = [];
    this.held_sources = new Map();
    this.sequence = 0n;
    this.focus_epoch = 0;
    this.x = 256;
    this.y = 192;
  }

  receive({ source_id, action = 0, held = false, raw_time_ms, client_x, client_y, inverse_transform }) {
    require_condition(this.records.length < this.maximum_records, 'QUOTA_EXCEEDED', 'Input queue is full.');
    require_condition(Number.isFinite(raw_time_ms) && [0, ACTION.LEFT, ACTION.RIGHT].includes(action) &&
      typeof source_id === 'string' && typeof held === 'boolean', 'INVALID_INPUT', 'Invalid input snapshot.');
    let x = this.x;
    let y = this.y;
    if (client_x !== undefined || client_y !== undefined) {
      require_condition(inverse_transform?.length === 6 &&
        [client_x, client_y, ...inverse_transform].every(Number.isFinite), 'INVALID_INPUT', 'Invalid input transform.');
      x = inverse_transform[0] * client_x + inverse_transform[2] * client_y + inverse_transform[4];
      y = inverse_transform[1] * client_x + inverse_transform[3] * client_y + inverse_transform[5];
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
    this.records.push({ sequence: ++this.sequence, raw_time_ms, x, y, action_bits, source: source_id, focus_epoch: this.focus_epoch });
  }

  release_all(raw_time_ms) {
    require_condition(Number.isFinite(raw_time_ms) && this.records.length < this.maximum_records,
      'INVALID_INPUT', 'Cannot append release-all input.');
    this.held_sources.clear();
    this.focus_epoch++;
    this.records.push({ sequence: ++this.sequence, raw_time_ms, x: this.x, y: this.y,
      action_bits: 0, source: 'release_all', focus_epoch: this.focus_epoch });
  }

  flush(submit) {
    // A rejected submission retains every record for explicit recovery.
    submit(this.records);
    this.records.length = 0;
  }
}
