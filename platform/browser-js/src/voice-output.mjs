import { schema, readRecordInto, validateSpan } from '../../../engine/abi/records.mjs';
import { require_condition } from './errors.mjs';

export class Voice_Output {
  constructor() {
    this.summary = {};
    this.required = {};
    this.command = {};
    this.valid = false;
  }

  bind(bytes) {
    this.valid = false;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    readRecordInto(this.view, 0, 44, this.summary);
    const frame = this.summary;
    require_condition(frame.epoch > 0 && frame.flags <= 1 && frame.reserved === 0 && frame.reserved_tail === 0n &&
      frame.batch_token > 0n && Number.isFinite(frame.committed_ms) && frame.total_bytes === BigInt(bytes.byteLength) &&
      this.view.getUint32(schema.transport.record_header.byte_size, true) === 64 && frame.commands_offset >= 64 && frame.commands_stride === 112 &&
      frame.commands_offset + frame.commands_count * frame.commands_stride === bytes.byteLength,
    'INVALID_VOICE_OUTPUT', 'Invalid voice frame.');
    validateSpan(this.view, frame.commands_offset, frame.commands_count, frame.commands_stride, 8);
    let previous_sequence = 0n;
    for (let command_index = 0; command_index < frame.commands_count; command_index++) {
      const command_offset = frame.commands_offset + command_index * frame.commands_stride;
      require_condition(this.view.getUint32(command_offset + schema.transport.record_header.byte_size, true) === frame.commands_stride,
        'INVALID_VOICE_OUTPUT', 'Invalid voice command header size.');
      // The engine owns command value policy. The reader checks only the frame
      // protocol: ordered sequences, epochs not newer than the frame, valid
      // kind indices for family mapping and untouched reserved fields.
      const command = this.record_into(command_index, this.command);
      require_condition(command.sequence > previous_sequence && command.epoch > 0 && command.epoch <= frame.epoch &&
        command.command_kind >= 1 && command.command_kind <= 4 && command.reserved === 0,
      'INVALID_VOICE_OUTPUT', 'Invalid voice command.');
      previous_sequence = command.sequence;
    }
    this.valid = true;
    return this;
  }

  record_into(command_index, target) {
    require_condition(Number.isInteger(command_index) && command_index >= 0 && command_index < this.summary.commands_count,
      'INVALID_ARGUMENT', 'Voice command index is outside the frame.');
    return readRecordInto(this.view, this.summary.commands_offset + command_index * this.summary.commands_stride, 45, target);
  }
}
