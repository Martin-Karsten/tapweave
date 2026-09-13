import { readRecord, readRecordInto, checkedSpan, validateSpan, writeRecord, schema } from '../../../engine/abi/records.mjs';
import { Render_Resources } from './render-resources.js';
import { Voice_Output } from './voice-output.js';
export { Voice_Output } from './voice-output.js';
import { read_record, record_size,
  type Draw_Output_Header, type Engine_Capabilities_Record, type Engine_Diagnostic, type Gameplay_Output_Header,
  type Input_Snapshot_Values, type Odin_Exports, type Output_Capabilities_Record,
  type Prepared_Descriptor_Record, type Preparation_Capabilities_Record, type Record_Values,
  type Render_Capacity_Record, type Sample_Binding_Values, type Simulation_Capabilities_Record,
  type Transport_Capabilities_Record, type Viewport_Values, type Voice_Capacity_Record,
  type Presentation_Output_Header } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';

const MAILBOX = schema.transport.mailbox;
const BYTE_SPAN = schema.transport.byte_span;
const RECORD_HEADER = schema.transport.record_header;
const VIEWPORT_RECORD = schema.records.find(record => record.kind === 29)!;
const VIEWPORT_FIELDS = Object.entries(VIEWPORT_RECORD.fields);

export interface Input_Span {
  address: number;
  count: number;
  token: bigint;
}

export interface Session_Create_Options {
  arena_bytes?: bigint;
  lead_in_ms?: number;
  input_capacity?: number;
  batch_capacity?: number;
}

export type Session_Operation = (engine_handle: bigint, session_handle: bigint, time_ms: number,
  result_address: number) => number;

interface Output_Array_Span {
  offset: number;
  count: number;
  stride: number;
  kind: number;
  offset_field: string;
  count_field: string;
  stride_field: string;
}

export class Engine_Bridge {
  wasm: Odin_Exports;
  mailbox_address: number;
  engine_handle = 0n;
  map_handles = new Set<bigint>();
  session_handles = new Set<bigint>();
  input_span: Input_Span | null = null;
  capabilities!: Engine_Capabilities_Record;
  preparation_capabilities!: Preparation_Capabilities_Record;
  simulation_capabilities!: Simulation_Capabilities_Record;
  output_capabilities!: Output_Capabilities_Record;
  transport_capabilities!: Transport_Capabilities_Record;
  private scene_mailbox_view: DataView | null = null;
  private scene_mailbox_bytes: Uint8Array | null = null;

  static async create(wasm_bytes: ArrayBuffer | Uint8Array, diagnostics: (message: Engine_Diagnostic) => void = () => {}) {
    let wasm_memory: WebAssembly.Memory;
    const { instance } = await WebAssembly.instantiate(wasm_bytes, { odin_env: {
      sin: Math.sin,
      cos: Math.cos,
      pow: Math.pow,
      write(file_descriptor: number, address: number, byte_count: number) {
        diagnostics({ kind: 'engine_log', file_descriptor,
          message: new TextDecoder().decode(new Uint8Array(wasm_memory.buffer, address, byte_count)) });
        return byte_count;
      },
      rand_bytes(address: number, byte_count: number) {
        const bytes = new Uint8Array(wasm_memory.buffer, address, byte_count);
        for (let byte_offset = 0; byte_offset < bytes.length; byte_offset += 65536) {
          crypto.getRandomValues(bytes.subarray(byte_offset, byte_offset + 65536));
        }
      },
    } }) as unknown as { instance: WebAssembly.Instance };
    const wasm_exports = instance.exports as unknown as Odin_Exports;
    wasm_memory = wasm_exports.memory;
    return new Engine_Bridge(wasm_exports);
  }

  constructor(wasm_exports: Odin_Exports) {
    this.wasm = wasm_exports;
    this.mailbox_address = this.wasm.oe_abi_control();
    this.write_creation(1, { flags: 1 });
    this.check_status(this.wasm.oe_engine_create(this.mailbox_address, this.result_address, this.error_address));
    this.engine_handle = this.read_handle();
    try {
      this.check_status(this.wasm.oe_engine_capabilities(this.engine_handle, this.result_address), false);
      this.capabilities = read_record(this.view(), this.read_span().address, 4);
      require_condition(this.capabilities.abi_major === 2, 'UNSUPPORTED', 'ABI v2 is required.');
      this.check_status(this.wasm.oe_preparation_capabilities(this.engine_handle, this.result_address), false);
      this.preparation_capabilities = read_record(this.view(), this.read_span().address, 14);
      require_condition(this.preparation_capabilities.preparation_version === 2,
        'UNSUPPORTED', 'Preparation version 2 is required.');
      this.check_status(this.wasm.oe_simulation_capabilities(this.engine_handle, this.result_address), false);
      this.simulation_capabilities = read_record(this.view(), this.read_span().address, 25);
      this.check_status(this.wasm.oe_output_capabilities(this.engine_handle, this.result_address), false);
      this.output_capabilities = read_record(this.view(), this.read_span().address, 34);
      this.check_status(this.wasm.oe_transport_capabilities(this.engine_handle, this.result_address), false);
      this.transport_capabilities = read_record(this.view(), this.read_span().address, 41);
      const transport = this.transport_capabilities;
      require_condition(transport.resource_version === 1 && transport.circle_animation_version === 1 &&
        transport.draw_version === 1 && transport.voice_version === 2 && (transport.voice_command_mask & 1) === 1 &&
        (transport.voice_command_mask & ~15) === 0 &&
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

  check_status(status: number, has_error_record = true) {
    if (status !== 0) {
      const details = has_error_record ? readRecord(this.view(), this.error_address, 7) : {};
      throw new Browser_Error('ENGINE_' + status, 'Engine operation failed (status ' + status + ').', details);
    }
  }

  write_creation(kind: number, fields: Record<string, Record_Values>) {
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

  prepare_map(bytes: Uint8Array) {
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
  reserve_input(byte_count: number) {
    require_condition(Number.isSafeInteger(byte_count) && byte_count > 0 && byte_count <= 0xffffffff,
      'INVALID_SPAN', 'Invalid inbox capacity.');
    this.check_status(this.wasm.oe_buffer_reserve(this.engine_handle, 1, BigInt(byte_count), this.result_address), false);
    this.input_span = this.read_span();
    return this.input_span;
  }

  create_session(map_handle: bigint, { arena_bytes = 16n * 1024n * 1024n, lead_in_ms = 0,
    input_capacity = 8192, batch_capacity = 256 }: Session_Create_Options = {}) {
    require_condition(Number.isSafeInteger(batch_capacity) && batch_capacity > 0 && batch_capacity <= input_capacity,
      'INVALID_ARGUMENT', 'Invalid input batch capacity.');
    this.reserve_input(batch_capacity * record_size(23));
    this.write_creation(18, { flags: 2, arena_bytes, lead_in_ms, input_capacity });
    this.check_status(this.wasm.oe_session_create(this.engine_handle, map_handle,
      this.mailbox_address, this.result_address, this.error_address));
    const session_handle = this.read_handle();
    this.session_handles.add(session_handle);
    return session_handle;
  }

  submit_inputs(session_handle: bigint, records: Input_Snapshot_Values[]) {
    const stride = record_size(23);
    const inbox = this.input_span;
    require_condition(inbox && records.length <= Math.floor(inbox.count / stride),
      'QUOTA_EXCEEDED', 'Reserve a sufficient input batch before starting.');
    const view = this.view();
    for (let input_index = 0; input_index < records.length; input_index++) {
      writeRecord(view, inbox!.address + input_index * stride, 23,
        records[input_index] as unknown as Record<string, Record_Values>);
    }
    // The current M2 input export returns a status only, not an ErrorV1 record.
    this.check_status(this.wasm.oe_session_inputs_from_reserved(this.engine_handle, session_handle,
      inbox!.token, records.length, this.error_address), false);
  }

  bind_sample(session_handle: bigint, binding: Sample_Binding_Values) {
    this.write_creation(28, binding);
    this.check_status(this.wasm.oe_session_bind_sample(this.engine_handle, session_handle, this.mailbox_address), false);
  }

  scene_capabilities() {
    require_condition(typeof this.wasm.oe_scene_capabilities === 'function', 'UNSUPPORTED', 'Scene rendering is unavailable.');
    this.check_status(this.wasm.oe_scene_capabilities(this.engine_handle, this.result_address), false);
    const capabilities = read_record(this.view(), this.read_span().address, 49);
    require_condition(capabilities.resource_version === 1 && capabilities.draw_version === 1 &&
      capabilities.primitive_mask === 31 && capabilities.flags === 0 && capabilities.reserved === 0,
      'UNSUPPORTED', 'Unsupported scene rendering protocol.');
    return capabilities;
  }

  scene_resources(map_handle: bigint) {
    this.check_status(this.wasm.oe_map_scene_resources(this.engine_handle, map_handle, this.result_address), false);
    return new Render_Resources(this.copy_output());
  }

  scene_reserve(session_handle: bigint, instance_capacity = 0, arena_bytes = 0n) {
    this.write_creation(48, { instance_capacity, arena_bytes });
    this.check_status(this.wasm.oe_session_scene_reserve(this.engine_handle, session_handle,
      this.mailbox_address, this.result_address), false);
    return read_record(this.view(), this.read_span().address, 37);
  }

  scene_draw(session_handle: bigint, time_ms: number, viewport: Viewport_Values, output: Scene_Output) {
    require_condition(output instanceof Scene_Output, 'INVALID_DRAW', 'A reusable scene reader is required.');
    if (this.scene_mailbox_view?.buffer !== this.wasm.memory.buffer) {
      this.scene_mailbox_view = new DataView(this.wasm.memory.buffer);
      this.scene_mailbox_bytes = new Uint8Array(this.wasm.memory.buffer, this.mailbox_address, MAILBOX.creation_size);
    }
    for (const [field_name] of VIEWPORT_FIELDS) {
      require_condition(Number.isFinite(viewport[field_name as keyof Viewport_Values]), 'INVALID_DRAW', 'Non-finite scene viewport.');
    }
    this.scene_mailbox_bytes!.fill(0);
    const view = this.scene_mailbox_view;
    view.setUint16(this.mailbox_address + RECORD_HEADER.kind, 29, true);
    view.setUint16(this.mailbox_address + RECORD_HEADER.version, 1, true);
    view.setUint32(this.mailbox_address + RECORD_HEADER.byte_size, VIEWPORT_RECORD.size, true);
    for (const [field_name, [field_offset]] of VIEWPORT_FIELDS) {
      view.setFloat64(this.mailbox_address + Number(field_offset), Number(viewport[field_name as keyof Viewport_Values]), true);
    }
    const status = this.wasm.oe_session_scene_draw(this.engine_handle, session_handle, time_ms, this.mailbox_address, this.result_address);
    if (status === 8) readRecordInto(this.view(), this.read_span().address, 37, output.required);
    this.check_status(status, false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  render_resources(map_handle: bigint) {
    this.check_status(this.wasm.oe_map_render_resources(this.engine_handle, map_handle, this.result_address), false);
    return new Render_Resources(this.copy_output());
  }

  session_render_resources(session_handle: bigint) {
    this.check_status(this.wasm.oe_session_render_resources(this.engine_handle, session_handle, this.result_address), false);
    return new Render_Resources(this.copy_output());
  }

  render_reserve(session_handle: bigint, instance_capacity = 0, arena_bytes = 0n) {
    this.write_creation(36, { instance_capacity, arena_bytes });
    this.check_status(this.wasm.oe_session_render_reserve(this.engine_handle, session_handle,
      this.mailbox_address, this.result_address), false);
    return read_record(this.view(), this.read_span().address, 37);
  }

  voice_reserve(session_handle: bigint, command_capacity = 0, arena_bytes = 0n) {
    this.write_creation(42, { command_capacity, arena_bytes, flags: 1 });
    this.check_status(this.wasm.oe_session_voice_reserve(this.engine_handle, session_handle,
      this.mailbox_address, this.result_address), false);
    return read_record(this.view(), this.read_span().address, 43);
  }

  voice_output(session_handle: bigint, output: Voice_Output) {
    require_condition(output instanceof Voice_Output, 'INVALID_ARGUMENT', 'Reusable voice output is required.');
    const status = this.wasm.oe_session_voice_output(this.engine_handle, session_handle, this.result_address);
    if (status === 8) readRecordInto(this.view(), this.read_span().address, 43, output.required);
    this.check_status(status, false);
    const span = this.read_span();
    return output.bind(new Uint8Array(this.wasm.memory.buffer, span.address, span.count));
  }

  draw(session_handle: bigint, time_ms: number, viewport: Viewport_Values, output: Draw_Output) {
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

  playfield_transform(viewport: Viewport_Values) {
    this.write_creation(29, viewport);
    this.check_status(this.wasm.oe_playfield_transform(this.engine_handle, this.mailbox_address, this.result_address), false);
    return readRecord(this.view(), this.read_span().address, 30);
  }

  copy_output() {
    const span = this.read_span();
    return new Uint8Array(this.wasm.memory.buffer, span.address, span.count).slice();
  }

  session_output(operation: Session_Operation, session_handle: bigint, time_ms: number) {
    this.check_status(operation(this.engine_handle, session_handle, time_ms, this.result_address), false);
    return new Session_Output(this.copy_output(), 19);
  }

  advance(session_handle: bigint, time_ms: number) {
    return this.session_output(this.wasm.oe_session_advance, session_handle, time_ms);
  }

  // The caller owns and reuses output. Its borrowed records last until the next
  // output-writing call on this session. Admission must finish before acknowledgement.
  advance_output(session_handle: bigint, time_ms: number, output: Gameplay_Output) {
    require_condition(output instanceof Gameplay_Output, 'INVALID_ARGUMENT', 'Reusable gameplay output is required.');
    this.check_status(this.wasm.oe_session_advance_output(this.engine_handle, session_handle,
      time_ms, this.result_address), false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  presentation(session_handle: bigint, time_ms: number, output: Presentation_Output) {
    require_condition(output instanceof Presentation_Output, 'INVALID_ARGUMENT', 'Reusable presentation output is required.');
    this.check_status(this.wasm.oe_session_presentation(this.engine_handle, session_handle,
      time_ms, this.result_address), false);
    output.bind(this.wasm.memory.buffer, this.result_address);
    return output;
  }

  snapshot(session_handle: bigint, time_ms: number) {
    return this.session_output(this.wasm.oe_session_snapshot, session_handle, time_ms);
  }

  pause(session_handle: bigint, time_ms: number) {
    return this.session_output(this.wasm.oe_session_pause, session_handle, time_ms);
  }

  resume(session_handle: bigint, { beatmap_ms, audio_seconds }: { beatmap_ms: number; audio_seconds: number }) {
    this.write_creation(22, { beatmap_ms, audio_seconds, rate: 1 });
    this.check_status(this.wasm.oe_session_resume(this.engine_handle, session_handle, this.mailbox_address), false);
  }

  acknowledge(session_handle: bigint, batch_token: bigint) {
    this.check_status(this.wasm.oe_session_acknowledge(this.engine_handle, session_handle, batch_token), false);
  }

  reset_session(session_handle: bigint, lead_in_ms = 0) {
    this.check_status(this.wasm.oe_session_reset(this.engine_handle, session_handle, lead_in_ms), false);
  }

  result(session_handle: bigint) {
    this.check_status(this.wasm.oe_session_result(this.engine_handle, session_handle, this.result_address), false);
    return new Session_Output(this.copy_output(), 24);
  }

  export_replay(session_handle: bigint) {
    this.check_status(this.wasm.oe_session_replay_export(this.engine_handle, session_handle, this.result_address), false);
    return this.copy_output();
  }

  load_replay(session_handle: bigint, bytes: Uint8Array) {
    require_condition(bytes instanceof Uint8Array, 'INVALID_ARGUMENT', 'Replay bytes are required.');
    const inbox = this.reserve_input(bytes.length);
    new Uint8Array(this.wasm.memory.buffer, inbox.address, bytes.length).set(bytes);
    this.check_status(this.wasm.oe_session_replay_load(this.engine_handle, session_handle, inbox.token, bytes.length), false);
  }

  seek_replay(session_handle: bigint, time_ms: number) {
    return this.session_output(this.wasm.oe_session_replay_seek, session_handle, time_ms);
  }

  release_session(session_handle: bigint) {
    if (this.session_handles.has(session_handle)) {
      this.check_status(this.wasm.oe_session_release(this.engine_handle, session_handle), false);
      this.session_handles.delete(session_handle);
    }
  }

  describe_map(map_handle: bigint) {
    this.check_status(this.wasm.oe_map_describe(this.engine_handle, map_handle, this.result_address), false);
    const span = this.read_span();
    // This owned copy survives candidate allocations and map release.
    const bytes = new Uint8Array(this.wasm.memory.buffer, span.address, span.count).slice();
    return new Prepared_Description(bytes);
  }

  release_map(map_handle: bigint) {
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
  kind: number;
  valid = false;
  arrays: Output_Array_Span[];
  view: DataView | null = null;
  address = 0;
  byte_count = 0;
  summary: Record<string, Record_Values> = {};

  constructor(kind: number, arrays: Output_Array_Span[]) {
    this.kind = kind;
    this.arrays = arrays;
  }

  bind(buffer: ArrayBuffer, span_address: number) {
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
    require_condition(this.byte_count >= record_size(this.kind), 'INVALID_SPAN', 'Truncated output header.');
    const header_size = view.getUint32(this.address + RECORD_HEADER.byte_size, true);
    require_condition(header_size <= this.byte_count, 'INVALID_SPAN', 'Oversized output header.');
    readRecordInto(view, this.address, this.kind, this.summary);
    require_condition(this.summary.total_bytes === BigInt(this.byte_count) &&
      (this.kind !== 31 || this.summary.objects_count === 0 &&
      this.summary.batch_token === view.getBigUint64(span_address + BYTE_SPAN.token, true)),
    'INVALID_SPAN', 'Invalid borrowed output summary.');
    let previous_end = header_size;
    for (const span of this.arrays) {
      previous_end = this.bind_array(span, this.summary[span.offset_field] as number,
        this.summary[span.count_field] as number, this.summary[span.stride_field] as number, previous_end);
    }
    this.valid = true;
  }

  bind_array(span: Output_Array_Span, offset: number, count: number, stride: number, previous_end: number) {
    require_condition(offset >= previous_end && offset % 8 === 0 &&
      stride >= record_size(span.kind) && stride % 8 === 0 && offset <= this.byte_count &&
      count <= Math.floor((this.byte_count - offset) / stride), 'INVALID_SPAN', 'Invalid output array.');
    // Validate headers without materializing event objects or allocating subviews.
    for (let record_index = 0; record_index < count; record_index++) {
      const address = this.address + offset + record_index * stride;
      const size = this.view!.getUint32(address + RECORD_HEADER.byte_size, true);
      require_condition(this.view!.getUint16(address + RECORD_HEADER.kind, true) === span.kind &&
        this.view!.getUint16(address + RECORD_HEADER.version, true) === 1 && size >= record_size(span.kind) &&
        size <= stride && size % 8 === 0, 'INVALID_SPAN', 'Invalid output record.');
    }
    span.offset = offset;
    span.count = count;
    span.stride = stride;
    return offset + count * stride;
  }

  record_into(span: Output_Array_Span, record_index: number, target: Record<string, Record_Values>) {
    require_condition(this.valid && this.arrays.includes(span) &&
      Number.isSafeInteger(record_index) && record_index >= 0 && record_index < span.count,
    'INVALID_SPAN', 'Output record index is out of bounds.');
    return readRecordInto(this.view!, this.address + span.offset + record_index * span.stride, span.kind, target);
  }
}

function output_array(field_name: string, kind: number): Output_Array_Span {
  return { offset: 0, count: 0, stride: 0, kind,
    offset_field: field_name + '_offset', count_field: field_name + '_count', stride_field: field_name + '_stride' };
}

export class Gameplay_Output extends Borrowed_Output {
  declare summary: Gameplay_Output_Header;
  judgements: Output_Array_Span;
  audio: Output_Array_Span;

  constructor() {
    const judgements = output_array('judgements', 21);
    const audio = output_array('audio', 27);
    super(31, [judgements, audio]);
    this.judgements = judgements;
    this.audio = audio;
  }
}

export class Presentation_Output extends Borrowed_Output {
  declare summary: Presentation_Output_Header;
  objects: Output_Array_Span;

  constructor() {
    const objects = output_array('objects', 33);
    super(32, [objects]);
    this.objects = objects;
  }
}

export class Draw_Output extends Borrowed_Output {
  declare summary: Draw_Output_Header;
  resources: Render_Resources;
  engine_epoch: number;
  instances: Output_Array_Span;
  batches: Output_Array_Span;
  required: Record<string, Record_Values> = {};

  constructor(resources: Render_Resources, engine_epoch: number) {
    const instances = output_array('instances', 39);
    const batches = output_array('batches', 40);
    super(38, [instances, batches]);
    require_condition(resources instanceof Render_Resources, 'INVALID_ARGUMENT', 'A validated render attachment is required.');
    this.resources = resources;
    this.engine_epoch = engine_epoch;
    this.instances = instances;
    this.batches = batches;
  }

  override bind(buffer: ArrayBuffer, span_address: number) {
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

export class Scene_Output extends Borrowed_Output {
  declare summary: Draw_Output_Header;
  resources: Render_Resources;
  engine_epoch: number;
  instances: Output_Array_Span;
  batches: Output_Array_Span;
  required: Record<string, Record_Values> = {};

  constructor(resources: Render_Resources, engine_epoch: number) {
    const instances = output_array('instances', 50);
    const batches = output_array('batches', 51);
    super(47, [instances, batches]);
    require_condition(resources instanceof Render_Resources && resources.scene, 'INVALID_ARGUMENT', 'A validated render attachment is required.');
    this.resources = resources;
    this.engine_epoch = engine_epoch;
    this.instances = instances;
    this.batches = batches;
  }

  override bind(buffer: ArrayBuffer, span_address: number) {
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
  bytes: Uint8Array;
  view: DataView;
  summary: Record<string, Record_Values>;
  spans = new Map<string, Output_Array_Span>();

  constructor(bytes: Uint8Array, kind: number) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = readRecord(this.view, 0, kind);
    require_condition(kind === 19 || kind === 24, 'UNSUPPORTED', 'Unknown session output.');
    if (kind === 19) {
      require_condition(this.summary.total_bytes === BigInt(bytes.length), 'INVALID_SPAN', 'Snapshot size mismatch.');
    }
    const arrays: [string, number][] = kind === 19 ? [['objects', 20], ['judgements', 21], ['audio', 27]] : [['counts', 26]];
    let previous_end = record_size(kind);
    for (const [field_name, record_kind] of arrays) {
      const offset = this.summary[field_name + '_offset'] as number;
      const count = this.summary[field_name + '_count'] as number;
      const stride = this.summary[field_name + '_stride'] as number;
      require_condition(offset >= previous_end && stride >= record_size(record_kind) && stride % 8 === 0,
        'INVALID_SPAN', 'Invalid session output stride or offset.');
      checkedSpan(this.view, offset, count, stride, 8);
      previous_end = offset + count * stride;
      // Validate each record within its stride, including append-only byte_size.
      for (let record_index = 0; record_index < count; record_index++) {
        readRecord(new DataView(bytes.buffer, bytes.byteOffset + offset + record_index * stride, stride), 0, record_kind);
      }
      this.spans.set(field_name, { offset, count, stride, kind: record_kind, offset_field: field_name + '_offset',
        count_field: field_name + '_count', stride_field: field_name + '_stride' });
    }
  }

  record(field_name: string, record_index: number) {
    const span = this.spans.get(field_name);
    require_condition(span && Number.isSafeInteger(record_index) && record_index >= 0 && record_index < span.count,
      'INVALID_SPAN', 'Session record index is out of bounds.');
    return readRecord(this.view, span.offset + record_index * span.stride, span.kind);
  }
}

export class Prepared_Description {
  bytes: Uint8Array;
  view: DataView;
  summary: Prepared_Descriptor_Record;
  playback: Record<string, Record_Values>;
  audio_filename: string;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = read_record(this.view, 0, 8);
    require_condition(this.summary.total_bytes === BigInt(bytes.length), 'INVALID_SPAN', 'Descriptor size mismatch.');
    const playback_span = this.array_span(this.summary, 'playback', record_size(17));
    require_condition(playback_span.count === 1, 'INVALID_SPAN', 'Expected one playback record.');
    this.playback = readRecord(this.view, playback_span.offset, 17);
    this.audio_filename = this.text(this.playback, 'audio_filename');
  }

  *records(parent: Record<string, Record_Values>, field_name: string, kind: number) {
    const span = this.array_span(parent, field_name, record_size(kind));
    for (let record_index = 0; record_index < span.count; record_index++) {
      yield readRecord(this.view, span.offset + record_index * span.stride, kind);
    }
  }

  *sample_candidates() {
    const samples = function* (descriptor: Prepared_Description, parent: Record<string, Record_Values>,
      field: string, object_id: number, component_id: number, loops_only = false) {
      let sample_index = 0;
      for (const sample of descriptor.records(parent, field, 11)) {
        const name = descriptor.text(sample, 'name');
        if (!loops_only || (sample.flags as number & 1) === 1) {
          yield { object_id, component_id, sample_index, name, use_beatmap: sample.use_beatmap !== 0,
            candidates: [...descriptor.records(sample, 'candidates', 12)].map(candidate => descriptor.text(candidate, 'name')) };
        }
        sample_index++;
      }
    };
    for (const object of this.records(this.summary, 'objects', 9)) {
      if (object.kind !== 2) yield* samples(this, object, 'samples', object.id as number, 0xffffffff);
      for (const component of this.records(object, 'components', 10)) {
        if (component.kind === 4) continue;
        yield* samples(this, component.kind === 3 ? object : component,
          component.kind === 3 ? 'tail_samples' : 'samples', object.id as number, component.id as number);
      }
      yield* samples(this, object, 'auxiliary_samples', object.id as number, 0xfffffffe, true);
    }
  }

  array_span(record: Record<string, Record_Values>, field_name: string, minimum_stride: number) {
    const offset = record[field_name + '_offset'] as number;
    const count = record[field_name + '_count'] as number;
    const stride = record[field_name + '_stride'] as number;
    require_condition(stride >= minimum_stride && (minimum_stride === 1 || stride % 8 === 0),
      'INVALID_SPAN', 'Invalid descriptor stride.');
    checkedSpan(this.view, offset, count, stride, minimum_stride === 1 ? 1 : 8);
    return { offset, count, stride };
  }

  text(record: Record<string, Record_Values>, field_name: string) {
    const span = this.array_span(record, field_name, 1);
    require_condition(span.stride === 1, 'INVALID_SPAN', 'Text stride must be one.');
    return new TextDecoder('utf-8', { fatal: true }).decode(checkedSpan(this.view, span.offset, span.count, 1));
  }
}
