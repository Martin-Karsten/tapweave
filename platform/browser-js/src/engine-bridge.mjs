import { schema, checkedSpan, readRecord, writeRecord } from '../../../engine/abi/records.mjs';
import { Browser_Error, require_condition } from './errors.mjs';

const MAILBOX = schema.transport.mailbox;
const BYTE_SPAN = schema.transport.byte_span;

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
    this.check_status(this.wasm.oe_buffer_reserve(this.engine_handle, 1, BigInt(bytes.length), this.result_address), false);
    const inbox = this.read_span();
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
    }
  }
}

export class Prepared_Description {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = readRecord(this.view, 0, 8);
    require_condition(this.summary.total_bytes === BigInt(bytes.length), 'INVALID_SPAN', 'Descriptor size mismatch.');
    const playback_span = this.array_span(this.summary, 'playback', 72);
    require_condition(playback_span.count === 1, 'INVALID_SPAN', 'Expected one playback record.');
    this.playback = readRecord(this.view, playback_span.offset, 17);
    this.audio_filename = this.text(this.playback, 'audio_filename');
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
