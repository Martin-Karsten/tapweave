import { Render_Resources } from './render-resources.mjs';
import { Voice_Output } from './voice-output.mjs';
export { Voice_Output } from './voice-output.mjs';
import { schema, checkedSpan, validateSpan, readRecord, readRecordInto, writeRecord } from '../../../engine/abi/records.mjs';
import { Browser_Error, require_condition } from './errors.mjs';

const MAILBOX = schema.transport.mailbox;
const BYTE_SPAN = schema.transport.byte_span;
const RECORD_HEADER = schema.transport.record_header;
const RECORDS = new Map(schema.records.map(record => [record.kind, record]));

export class Engine_Bridge {
  static async create(wasm_bytes, diagnostics = () => {}) {
    let wasm_memory;
    const { instance } = await WebAssembly.instantiate(wasm_bytes, { odin_env: {
      sin: Math.sin,
      cos: Math.cos,
      pow: Math.pow,
      write(file_descriptor, address, byte_count) {
        diagnostics({ kind: 'engine_log', file_descriptor,
          message: new TextDecoder().decode(new Uint8Array(wasm_memory.buffer, address, byte_count)) });
        return byte_count;
      },
      rand_bytes(address, byte_count) {
        const bytes = new Uint8Array(wasm_memory.buffer, address, byte_count);
        for (let byte_offset = 0; byte_offset < bytes.length; byte_offset += 65536) {
          crypto.getRandomValues(bytes.subarray(byte_offset, byte_offset + 65536));
        }
      },
    } });
    wasm_memory = instance.exports.memory;
    return new Engine_Bridge(instance.exports);
  }

  constructor(wasm_exports) {
    this.wasm = wasm_exports;
    this.mailbox_address = this.wasm.oe_abi_control();
    this.engine_handle = 0n;
    this.map_handles = new Set();
    this.session_handles = new Set();
    this.input_span = null;
    this.write_creation(1, { flags: 1 });
    this.check_status(this.wasm.oe_engine_create(this.mailbox_address, this.result_address, this.error_address));
    this.engine_handle = this.read_handle();
    try {
      this.check_status(this.wasm.oe_engine_capabilities(this.engine_handle, this.result_address), false);
      this.capabilities = readRecord(this.view(), this.read_span().address, 4);
      require_condition(this.capabilities.abi_major === 2, 'UNSUPPORTED', 'ABI v2 is required.');
      this.check_status(this.wasm.oe_preparation_capabilities(this.engine_handle, this.result_address), false);
      this.preparation_capabilities = readRecord(this.view(), this.read_span().address, 14);
      require_condition(this.preparation_capabilities.preparation_version === 2,
        'UNSUPPORTED', 'Preparation version 2 is required.');
      this.check_status(this.wasm.oe_simulation_capabilities(this.engine_handle, this.result_address), false);
      this.simulation_capabilities = readRecord(this.view(), this.read_span().address, 25);
      this.check_status(this.wasm.oe_output_capabilities(this.engine_handle, this.result_address), false);
      this.output_capabilities = readRecord(this.view(), this.read_span().address, 34);
      this.check_status(this.wasm.oe_transport_capabilities(this.engine_handle, this.result_address), false);
      this.transport_capabilities = readRecord(this.view(), this.read_span().address, 41);
      const transport = this.transport_capabilities;
      require_condition(transport.resource_version === 1 && transport.circle_animation_version === 1 &&
        transport.draw_version === 1 && transport.voice_version === 2 && (transport.voice_command_mask & 1) === 1 && (transport.voice_command_mask & ~15) === 0 &&
        transport.flags === 1 && transport.reserved === 0 && transport.max_draw_instances > 0,
      'UNSUPPORTED', 'Unsupported resource/draw/voice transport capabilities.');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get result_address() { return this.mailbox_address + MAILBOX.result; }
  get error_address() { return this.mailbox_address + MAILBOX.error; }

  // Never cache DataView or typed arrays across a WASM call.
  view() { return new DataView(this.wasm.memory.buffer); }

  check_status(status, has_error_record = true) {
    if (status !== 0) {
      const details = has_error_record ? readRecord(this.view(), this.error_address, 7) : {};
      throw new Browser_Error('ENGINE_' + status, 'Engine operation failed (status ' + status + ').', details);
    }
  }

  write_creation(kind, fields) {
    new Uint8Array(this.wasm.memory.buffer, this.mailbox_address, MAILBOX.creation_size).fill(0);
    writeRecord(this.view(), this.mailbox_address, kind, fields);
  }

  read_handle() {
    return this.view().getBigUint64(this.result_address + BYTE_SPAN.address, true);
  }

  read_span() {
    const view = this.view();
    checkedSpan(view, this.result_address, BYTE_SPAN.size, 1, 8);
    const address_value = view.getBigUint64(this.result_address + BYTE_SPAN.address, true);
    require_condition(address_value <= 0xffffffffn, 'INVALID_SPAN', 'WASM32 address overflow.');
    const address = Number(address_value);
    const count = view.getUint32(this.result_address + BYTE_SPAN.count, true);
    const token = view.getBigUint64(this.result_address + BYTE_SPAN.token, true);
    checkedSpan(view, address, count, 1);
    return { address, count, token };
  }

  prepare_map(bytes) {
    require_condition(this.engine_handle !== 0n, 'DISPOSED', 'Engine is disposed.');
    require_condition(bytes instanceof Uint8Array && BigInt(bytes.length) <= this.capabilities.raw_bytes,
      'QUOTA_EXCEEDED', 'Beatmap exceeds the engine input quota.');
    const inbox = this.reserve_input(bytes.length);
    new Uint8Array(this.wasm.memory.buffer, inbox.address, bytes.length).set(bytes);
    this.write_creation(2, { token: inbox.token, count: bytes.length, flags: 2 });
    this.check_status(this.wasm.oe_map_prepare(this.engine_handle, this.mailbox_address, this.result_address, this.error_address));
    const map_handle = this.read_handle();
    this.map_handles.add(map_handle);
    try {
      return { map_handle, descriptor: this.describe_map(map_handle) };
    } catch (error) {
      this.release_map(map_handle);
      throw error;
    }
  }

  // Explicit preparation phase: submission never grows the inbox during play.
  reserve_input(byte_count) {
    require_condition(Number.isSafeInteger(byte_count) && byte_count > 0 && byte_count <= 0xffffffff,
      'INVALID_SPAN', 'Invalid inbox capacity.');
    this.check_status(this.wasm.oe_buffer_reserve(this.engine_handle, 1, BigInt(byte_count), this.result_address), false);
    this.input_span = this.read_span();
    return this.input_span;
  }

  create_session(map_handle, { arena_bytes = 16n * 1024n * 1024n, lead_in_ms = 0,
    input_capacity = 8192, batch_capacity = 256 } = {}) {
    require_condition(Number.isSafeInteger(batch_capacity) && batch_capacity > 0 && batch_capacity <= input_capacity,
      'INVALID_ARGUMENT', 'Invalid input batch capacity.');
    this.reserve_input(batch_capacity * RECORDS.get(23).size);
    this.write_creation(18, { flags: 2, arena_bytes, lead_in_ms, input_capacity });
    this.check_status(this.wasm.oe_session_create(this.engine_handle, map_handle,
      this.mailbox_address, this.result_address, this.error_address));
    const session_handle = this.read_handle();
    this.session_handles.add(session_handle);
    return session_handle;
  }

  submit_inputs(session_handle, records) {
    const stride = RECORDS.get(23).size;
    const inbox = this.input_span;
    require_condition(inbox && records.length <= Math.floor(inbox.count / stride),
      'QUOTA_EXCEEDED', 'Reserve a sufficient input batch before starting.');
    const view = this.view();
    for (let input_index = 0; input_index < records.length; input_index++) {
      writeRecord(view, inbox.address + input_index * stride, 23, records[input_index]);
    }
    // The current M2 input export returns a status only, not an ErrorV1 record.
    this.check_status(this.wasm.oe_session_inputs_from_reserved(this.engine_handle, session_handle,
      inbox.token, records.length, this.error_address), false);
  }

  bind_sample(session_handle, binding) {
    this.write_creation(28, binding);
    this.check_status(this.wasm.oe_session_bind_sample(this.engine_handle, session_handle, this.mailbox_address), false);
  }

  render_resources(map_handle) {
    this.check_status(this.wasm.oe_map_render_resources(this.engine_handle, map_handle, this.result_address), false);
    return new Render_Resources(this.copy_output());
  }

  session_render_resources(session_handle) {
    this.check_status(this.wasm.oe_session_render_resources(this.engine_handle, session_handle, this.result_address), false);
    return new Render_Resources(this.copy_output());
  }

  render_reserve(session_handle, instance_capacity = 0, arena_bytes = 0n) {
    this.write_creation(36, { instance_capacity, arena_bytes });
    this.check_status(this.wasm.oe_session_render_reserve(this.engine_handle, session_handle,
      this.mailbox_address, this.result_address), false);
    return readRecord(this.view(), this.read_span().address, 37);
  }

  voice_reserve(session_handle, command_capacity = 0, arena_bytes = 0n) {
    this.write_creation(42, { command_capacity, arena_bytes, flags: 1 });
    this.check_status(this.wasm.oe_session_voice_reserve(this.engine_handle, session_handle,
      this.mailbox_address, this.result_address), false);
    return readRecord(this.view(), this.read_span().address, 43);
  }

  voice_output(session_handle, output) {
    require_condition(output instanceof Voice_Output, 'INVALID_ARGUMENT', 'Reusable voice output is required.');
    const status = this.wasm.oe_session_voice_output(this.engine_handle, session_handle, this.result_address);
    if (status === 8) readRecordInto(this.view(), this.read_span().address, 43, output.required);
    this.check_status(status, false);
    const span = this.read_span();
    return output.bind(new Uint8Array(this.wasm.memory.buffer, span.address, span.count));
  }

  draw(session_handle, time_ms, viewport, output) {
    require_condition(output instanceof Draw_Output, 'INVALID_ARGUMENT', 'Reusable draw output is required.');
    this.write_creation(29, viewport);
    const status = this.wasm.oe_session_draw(this.engine_handle, session_handle, time_ms, this.mailbox_address, this.result_address);
    if (status === 8) {
      readRecordInto(this.view(), this.read_span().address, 37, output.required);
    }
    this.check_status(status, false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  playfield_transform(viewport) {
    this.write_creation(29, viewport);
    this.check_status(this.wasm.oe_playfield_transform(this.engine_handle, this.mailbox_address, this.result_address), false);
    return readRecord(this.view(), this.read_span().address, 30);
  }

  copy_output() {
    const span = this.read_span();
    return new Uint8Array(this.wasm.memory.buffer, span.address, span.count).slice();
  }

  session_output(operation, session_handle, time_ms) {
    this.check_status(operation(this.engine_handle, session_handle, time_ms, this.result_address), false);
    return new Session_Output(this.copy_output(), 19);
  }

  advance(session_handle, time_ms) {
    return this.session_output(this.wasm.oe_session_advance, session_handle, time_ms);
  }

  // The caller owns and reuses output. Its borrowed records last until the next
  // output-writing call on this session. Admission must finish before acknowledgement.
  advance_output(session_handle, time_ms, output) {
    require_condition(output instanceof Gameplay_Output, 'INVALID_ARGUMENT', 'Reusable gameplay output is required.');
    this.check_status(this.wasm.oe_session_advance_output(this.engine_handle, session_handle,
      time_ms, this.result_address), false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  presentation(session_handle, time_ms, output) {
    require_condition(output instanceof Presentation_Output, 'INVALID_ARGUMENT', 'Reusable presentation output is required.');
    this.check_status(this.wasm.oe_session_presentation(this.engine_handle, session_handle,
      time_ms, this.result_address), false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  snapshot(session_handle, time_ms) {
    return this.session_output(this.wasm.oe_session_snapshot, session_handle, time_ms);
  }

  pause(session_handle, time_ms) {
    return this.session_output(this.wasm.oe_session_pause, session_handle, time_ms);
  }

  resume(session_handle, { beatmap_ms, audio_seconds }) {
    this.write_creation(22, { beatmap_ms, audio_seconds, rate: 1 });
    this.check_status(this.wasm.oe_session_resume(this.engine_handle, session_handle, this.mailbox_address), false);
  }

  acknowledge(session_handle, batch_token) {
    this.check_status(this.wasm.oe_session_acknowledge(this.engine_handle, session_handle, batch_token), false);
  }

  reset_session(session_handle, lead_in_ms = 0) {
    this.check_status(this.wasm.oe_session_reset(this.engine_handle, session_handle, lead_in_ms), false);
  }

  result(session_handle) {
    this.check_status(this.wasm.oe_session_result(this.engine_handle, session_handle, this.result_address), false);
    return new Session_Output(this.copy_output(), 24);
  }

  export_replay(session_handle) {
    this.check_status(this.wasm.oe_session_replay_export(this.engine_handle, session_handle, this.result_address), false);
    return this.copy_output();
  }

  load_replay(session_handle, bytes) {
    require_condition(bytes instanceof Uint8Array, 'INVALID_ARGUMENT', 'Replay bytes are required.');
    const inbox = this.reserve_input(bytes.length);
    new Uint8Array(this.wasm.memory.buffer, inbox.address, bytes.length).set(bytes);
    this.check_status(this.wasm.oe_session_replay_load(this.engine_handle, session_handle, inbox.token, bytes.length), false);
  }

  seek_replay(session_handle, time_ms) {
    return this.session_output(this.wasm.oe_session_replay_seek, session_handle, time_ms);
  }

  release_session(session_handle) {
    if (this.session_handles.has(session_handle)) {
      this.check_status(this.wasm.oe_session_release(this.engine_handle, session_handle), false);
      this.session_handles.delete(session_handle);
    }
  }

  describe_map(map_handle) {
    this.check_status(this.wasm.oe_map_describe(this.engine_handle, map_handle, this.result_address), false);
    const span = this.read_span();
    // This owned copy survives candidate allocations and map release.
    const bytes = new Uint8Array(this.wasm.memory.buffer, span.address, span.count).slice();
    return new Prepared_Description(bytes);
  }

  release_map(map_handle) {
    if (this.map_handles.has(map_handle)) {
      this.check_status(this.wasm.oe_map_release(this.engine_handle, map_handle), false);
      this.map_handles.delete(map_handle);
    }
  }

  dispose() {
    if (this.engine_handle !== 0n) {
      this.check_status(this.wasm.oe_engine_release(this.engine_handle), false);
      this.engine_handle = 0n;
      this.map_handles.clear();
      this.session_handles.clear();
      this.input_span = null;
    }
  }
}

// One reusable reader per consumer, created before play. It borrows WASM memory;
// use record_into to copy only events that need durable browser queue ownership.
class Borrowed_Output {
  constructor(kind, arrays) {
    this.kind = kind;
    this.valid = false;
    this.arrays = arrays;
    this.view = null;
    this.address = 0;
    this.byte_count = 0;
    this.summary = {};
  }

  bind(buffer, span_address) {
    this.valid = false;
    if (this.view?.buffer !== buffer) {
      this.view = new DataView(buffer);
    }
    const view = this.view;
    validateSpan(view, span_address, BYTE_SPAN.size, 1, 8);
    require_condition(view.getUint32(span_address + BYTE_SPAN.reserved, true) === 0,
      'INVALID_SPAN', 'Unsupported output span flags.');
    const address = view.getBigUint64(span_address + BYTE_SPAN.address, true);
    require_condition(address <= 0xffffffffn, 'INVALID_SPAN', 'WASM32 address overflow.');
    this.address = Number(address);
    this.byte_count = view.getUint32(span_address + BYTE_SPAN.count, true);
    validateSpan(view, this.address, this.byte_count, 1, 8);
    require_condition(this.byte_count >= RECORDS.get(this.kind).size, 'INVALID_SPAN', 'Truncated output header.');
    const header_size = view.getUint32(this.address + RECORD_HEADER.byte_size, true);
    require_condition(header_size <= this.byte_count, 'INVALID_SPAN', 'Oversized output header.');
    readRecordInto(view, this.address, this.kind, this.summary);
    require_condition(this.summary.total_bytes === BigInt(this.byte_count) &&
      (this.kind !== 31 || this.summary.objects_count === 0 &&
      this.summary.batch_token === view.getBigUint64(span_address + BYTE_SPAN.token, true)),
    'INVALID_SPAN', 'Invalid borrowed output summary.');
    let previous_end = header_size;
    for (const span of this.arrays) {
      previous_end = this.bind_array(span, this.summary[span.offset_field],
        this.summary[span.count_field], this.summary[span.stride_field], previous_end);
    }
    this.valid = true;
  }

  bind_array(span, offset, count, stride, previous_end) {
    require_condition(offset >= previous_end && offset % 8 === 0 &&
      stride >= RECORDS.get(span.kind).size && stride % 8 === 0 && offset <= this.byte_count &&
      count <= Math.floor((this.byte_count - offset) / stride), 'INVALID_SPAN', 'Invalid output array.');
    // Validate headers without materializing event objects or allocating subviews.
    for (let record_index = 0; record_index < count; record_index++) {
      const address = this.address + offset + record_index * stride;
      const size = this.view.getUint32(address + RECORD_HEADER.byte_size, true);
      require_condition(this.view.getUint16(address + RECORD_HEADER.kind, true) === span.kind &&
        this.view.getUint16(address + RECORD_HEADER.version, true) === 1 && size >= RECORDS.get(span.kind).size &&
        size <= stride && size % 8 === 0, 'INVALID_SPAN', 'Invalid output record.');
    }
    span.offset = offset;
    span.count = count;
    span.stride = stride;
    return offset + count * stride;
  }

  record_into(span, record_index, target) {
    require_condition(this.valid && this.arrays.includes(span) &&
      Number.isSafeInteger(record_index) && record_index >= 0 && record_index < span.count,
    'INVALID_SPAN', 'Output record index is out of bounds.');
    return readRecordInto(this.view, this.address + span.offset + record_index * span.stride, span.kind, target);
  }
}

function output_array(field_name, kind) {
  return { offset: 0, count: 0, stride: 0, kind,
    offset_field: field_name + '_offset', count_field: field_name + '_count', stride_field: field_name + '_stride' };
}

export class Gameplay_Output extends Borrowed_Output {
  constructor() {
    const judgements = output_array('judgements', 21);
    const audio = output_array('audio', 27);
    super(31, [judgements, audio]);
    this.judgements = judgements;
    this.audio = audio;
  }
}

export class Presentation_Output extends Borrowed_Output {
  constructor() {
    const objects = output_array('objects', 33);
    super(32, [objects]);
    this.objects = objects;
  }
}

export class Draw_Output extends Borrowed_Output {
  constructor(resources, engine_epoch) {
    const instances = output_array('instances', 39);
    const batches = output_array('batches', 40);
    super(38, [instances, batches]);
    require_condition(resources instanceof Render_Resources, 'INVALID_ARGUMENT', 'A validated render attachment is required.');
    this.resources = resources;
    this.engine_epoch = engine_epoch;
    this.instances = instances;
    this.batches = batches;
    this.required = {};
  }

  bind(buffer, span_address) {
    super.bind(buffer, span_address);
    this.valid = false;
    // The engine owns ordering, batching and instance policy; this reader only
    // checks transport identity against the bound attachment and epoch.
    require_condition(this.summary.resource_id === this.resources.summary.resource_id &&
      this.summary.epoch === this.engine_epoch && this.summary.epoch > 0,
    'INVALID_DRAW', 'Stale draw identity.');
    this.valid = true;
  }
}

// Owned diagnostic/session output. Rendering must use the future active-set
// presentation protocol, not materialize one JS object per map object per frame.
export class Session_Output {
  constructor(bytes, kind) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = readRecord(this.view, 0, kind);
    this.spans = new Map();
    require_condition(kind === 19 || kind === 24, 'UNSUPPORTED', 'Unknown session output.');
    if (kind === 19) {
      require_condition(this.summary.total_bytes === BigInt(bytes.length), 'INVALID_SPAN', 'Snapshot size mismatch.');
    }
    const arrays = kind === 19 ? [['objects', 20], ['judgements', 21], ['audio', 27]] : [['counts', 26]];
    let previous_end = RECORDS.get(kind).size;
    for (const [field_name, record_kind] of arrays) {
      const offset = this.summary[field_name + '_offset'];
      const count = this.summary[field_name + '_count'];
      const stride = this.summary[field_name + '_stride'];
      require_condition(offset >= previous_end && stride >= RECORDS.get(record_kind).size && stride % 8 === 0,
        'INVALID_SPAN', 'Invalid session output stride or offset.');
      checkedSpan(this.view, offset, count, stride, 8);
      previous_end = offset + count * stride;
      // Validate each record within its stride, including append-only byte_size.
      for (let record_index = 0; record_index < count; record_index++) {
        readRecord(new DataView(bytes.buffer, bytes.byteOffset + offset + record_index * stride, stride), 0, record_kind);
      }
      this.spans.set(field_name, { offset, count, stride, kind: record_kind });
    }
  }

  record(field_name, record_index) {
    const span = this.spans.get(field_name);
    require_condition(span && Number.isSafeInteger(record_index) && record_index >= 0 && record_index < span.count,
      'INVALID_SPAN', 'Session record index is out of bounds.');
    return readRecord(this.view, span.offset + record_index * span.stride, span.kind);
  }
}

export class Prepared_Description {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = readRecord(this.view, 0, 8);
    require_condition(this.summary.total_bytes === BigInt(bytes.length), 'INVALID_SPAN', 'Descriptor size mismatch.');
    const playback_span = this.array_span(this.summary, 'playback', RECORDS.get(17).size);
    require_condition(playback_span.count === 1, 'INVALID_SPAN', 'Expected one playback record.');
    this.playback = readRecord(this.view, playback_span.offset, 17);
    this.audio_filename = this.text(this.playback, 'audio_filename');
  }

  *records(parent, field_name, kind) {
    const span = this.array_span(parent, field_name, RECORDS.get(kind).size);
    for (let record_index = 0; record_index < span.count; record_index++) {
      yield readRecord(this.view, span.offset + record_index * span.stride, kind);
    }
  }

  *sample_candidates() {
    const samples = function* (descriptor, parent, field, object_id, component_id, loops_only = false) {
      let sample_index = 0;
      for (const sample of descriptor.records(parent, field, 11)) {
        const name = descriptor.text(sample, 'name');
        if (!loops_only || ['sliderslide', 'sliderwhistle', 'spinnerspin'].includes(name)) {
          yield { object_id, component_id, sample_index, name, use_beatmap: sample.use_beatmap !== 0,
            candidates: [...descriptor.records(sample, 'candidates', 12)].map(candidate => descriptor.text(candidate, 'name')) };
        }
        sample_index++;
      }
    };
    for (const object of this.records(this.summary, 'objects', 9)) {
      if (object.kind !== 2) yield* samples(this, object, 'samples', object.id, 0xffffffff);
      for (const component of this.records(object, 'components', 10)) {
        if (component.kind === 4) continue;
        yield* samples(this, component.kind === 3 ? object : component,
          component.kind === 3 ? 'tail_samples' : 'samples', object.id, component.id);
      }
      yield* samples(this, object, 'auxiliary_samples', object.id, 0xfffffffe, true);
    }
  }

  array_span(record, field_name, minimum_stride) {
    const offset = record[field_name + '_offset'];
    const count = record[field_name + '_count'];
    const stride = record[field_name + '_stride'];
    require_condition(stride >= minimum_stride && (minimum_stride === 1 || stride % 8 === 0),
      'INVALID_SPAN', 'Invalid descriptor stride.');
    checkedSpan(this.view, offset, count, stride, minimum_stride === 1 ? 1 : 8);
    return { offset, count, stride };
  }

  text(record, field_name) {
    const span = this.array_span(record, field_name, 1);
    require_condition(span.stride === 1, 'INVALID_SPAN', 'Text stride must be one.');
    return new TextDecoder('utf-8', { fatal: true }).decode(checkedSpan(this.view, span.offset, span.count, 1));
  }
}
