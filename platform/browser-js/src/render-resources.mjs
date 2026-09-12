import { readRecord, schema } from '../../../engine/abi/records.mjs';
import { require_condition } from './errors.mjs';

// Owned immutable attachment. GPU context generations belong to the executor,
// never to this map identity or to the engine's resource identifier.
export class Render_Resources {
  constructor(bytes) {
    this.bytes = bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.summary = readRecord(view, 0, 35);
    const summary = this.summary;
    require_condition(summary.resource_id > 0n && summary.attachment_version === 1 && summary.flags === 0 &&
      summary.reserved === 0n && summary.total_bytes === BigInt(bytes.byteLength),
    'INVALID_RESOURCE', 'Invalid render resource identity or version.');
    let previous_end = schema.records.find(record => record.kind === 35).size;
    for (const [span_name, expected_stride] of [['vertices', 16], ['indices', 4], ['atlas', 1], ['vertex_shader', 1], ['fragment_shader', 1]]) {
      const offset = summary[span_name + '_offset'];
      const count = summary[span_name + '_count'];
      const stride = summary[span_name + '_stride'];
      require_condition(offset >= previous_end && offset % 8 === 0 && stride === expected_stride && summary[span_name + '_reserved'] === 0 &&
        offset <= bytes.byteLength && count <= Math.floor((bytes.byteLength - offset) / stride),
      'INVALID_RESOURCE', 'Invalid render resource span.');
      previous_end = offset + count * stride;
    }
    require_condition(summary.atlas_width > 0 && summary.atlas_height > 0 &&
      summary.atlas_count === summary.atlas_width * summary.atlas_height * 4,
    'INVALID_RESOURCE', 'Invalid RGBA atlas dimensions.');
    for (let vertex_index = 0; vertex_index < summary.vertices_count; vertex_index++) {
      const offset = summary.vertices_offset + vertex_index * summary.vertices_stride;
      require_condition(Number.isFinite(view.getFloat64(offset, true)) && Number.isFinite(view.getFloat64(offset + 8, true)),
        'INVALID_RESOURCE', 'Non-finite render vertex.');
    }
    for (let index_index = 0; index_index < summary.indices_count; index_index++) {
      require_condition(view.getUint32(summary.indices_offset + index_index * 4, true) < summary.vertices_count,
        'INVALID_RESOURCE', 'Index references an absent vertex.');
    }
    require_condition(summary.indices_count % 3 === 0 && summary.vertex_shader_count > 0 && summary.fragment_shader_count > 0,
      'INVALID_RESOURCE', 'Incomplete triangle or shader payload.');
  }

  // Private byte copy with the already validated summary. The GPU service owns
  // this snapshot; callers can mutate their reader without affecting recovery.
  own_snapshot() {
    return { bytes: this.bytes.slice(), summary: this.summary };
  }
}
