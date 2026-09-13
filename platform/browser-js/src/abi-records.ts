import { readRecord, schema } from '../../../engine/abi/records.mjs';
import { require_condition } from './errors.js';

export type Record_Values = number | bigint;

// Field names and JavaScript value types mirror engine/abi/records.json.
// tests/record-types.test.mjs validates this table against the generated schema,
// so ABI drift fails the suite instead of the reader call sites.
export const RECORD_FIELD_TYPES = {
  46: [["resource_id", "bigint"], ["attachment_version", "number"], ["flags", "number"], ["total_bytes", "bigint"], ["prepared_digest_0", "bigint"], ["prepared_digest_1", "bigint"], ["prepared_digest_2", "bigint"], ["prepared_digest_3", "bigint"], ["vertices_offset", "number"], ["vertices_count", "number"], ["vertices_stride", "number"], ["vertices_reserved", "number"], ["indices_offset", "number"], ["indices_count", "number"], ["indices_stride", "number"], ["indices_reserved", "number"], ["atlas_offset", "number"], ["atlas_count", "number"], ["atlas_stride", "number"], ["atlas_reserved", "number"], ["vertex_shader_offset", "number"], ["vertex_shader_count", "number"], ["vertex_shader_stride", "number"], ["vertex_shader_reserved", "number"], ["fragment_shader_offset", "number"], ["fragment_shader_count", "number"], ["fragment_shader_stride", "number"], ["fragment_shader_reserved", "number"], ["atlas_width", "number"], ["atlas_height", "number"], ["reserved", "bigint"]],
  47: [["epoch", "number"], ["state", "number"], ["resource_id", "bigint"], ["presentation_ms", "number"], ["committed_ms", "number"], ["scale", "number"], ["client_left", "number"], ["client_top", "number"], ["score", "bigint"], ["accuracy", "number"], ["health", "number"], ["combo", "number"], ["highest_combo", "number"], ["instances_offset", "number"], ["instances_count", "number"], ["instances_stride", "number"], ["batches_offset", "number"], ["batches_count", "number"], ["batches_stride", "number"], ["total_bytes", "bigint"], ["uniform_scale_x", "number"], ["uniform_scale_y", "number"], ["uniform_shift_x", "number"], ["uniform_shift_y", "number"]],
  49: [["resource_version", "number"], ["draw_version", "number"], ["primitive_mask", "number"], ["flags", "number"], ["max_instances", "number"], ["max_commands", "number"], ["max_upload_bytes", "number"], ["reserved", "number"]],
  50: [["primitive", "number"], ["layer", "number"], ["object_id", "number"], ["component_id", "number"], ["ordinal", "number"], ["flags", "number"], ["x", "number"], ["y", "number"], ["scale_x", "number"], ["scale_y", "number"], ["rotation", "number"], ["alpha", "number"], ["progress", "number"], ["colour", "number"], ["glyph", "number"], ["geometry_first", "number"], ["geometry_count", "number"], ["reserved", "bigint"], ["clip_start", "number"], ["clip_end", "number"]],
  51: [["layer", "number"], ["primitive", "number"], ["first_instance", "number"], ["instance_count", "number"], ["reserved", "bigint"]],
  52: [["probe_version", "number"], ["extension_count", "number"], ["extensions_offset", "number"], ["extensions_stride", "number"], ["flags", "number"], ["reserved", "number"], ["total_bytes", "bigint"]],

  4: [['abi_major', 'number'], ['abi_minor', 'number'], ['foundation', 'number'], ['gameplay', 'number'],
    ['legacy_max', 'number'], ['lazer_version', 'number'], ['raw_bytes', 'bigint'], ['arena_bytes', 'bigint'],
    ['build_id', 'bigint'], ['behavior_id', 'number'], ['numeric_mode', 'number']],
  8: [['behavior_id', 'number'], ['numeric_mode', 'number'], ['objects_offset', 'number'], ['objects_count', 'number'],
    ['objects_stride', 'number'], ['schedule_offset', 'number'], ['schedule_count', 'number'],
    ['schedule_stride', 'number'], ['raw_digest_0', 'bigint'], ['raw_digest_1', 'bigint'], ['raw_digest_2', 'bigint'],
    ['raw_digest_3', 'bigint'], ['prepared_digest_0', 'bigint'], ['prepared_digest_1', 'bigint'],
    ['prepared_digest_2', 'bigint'], ['prepared_digest_3', 'bigint'], ['total_bytes', 'bigint'], ['hp', 'number'],
    ['cs', 'number'], ['od', 'number'], ['ar', 'number'], ['slider_multiplier', 'number'], ['tick_rate', 'number'],
    ['stack_leniency', 'number'], ['breaks_offset', 'number'], ['breaks_count', 'number'], ['breaks_stride', 'number'],
    ['timing_points_offset', 'number'], ['timing_points_count', 'number'], ['timing_points_stride', 'number'],
    ['difficulty_points_offset', 'number'], ['difficulty_points_count', 'number'],
    ['difficulty_points_stride', 'number'], ['sample_points_offset', 'number'], ['sample_points_count', 'number'],
    ['sample_points_stride', 'number'], ['effect_points_offset', 'number'], ['effect_points_count', 'number'],
    ['effect_points_stride', 'number'], ['playback_offset', 'number'], ['playback_count', 'number'],
    ['playback_stride', 'number'], ['format_version', 'number'], ['reserved_244', 'number']],
  14: [['preparation_version', 'number'], ['behavior_id', 'number'], ['numeric_mode', 'number'], ['reserved', 'number']],
  23: [['sequence', 'bigint'], ['raw_time_ms', 'number'], ['effective_time_ms', 'number'], ['x', 'number'],
    ['y', 'number'], ['action_bits', 'number'], ['source_focus', 'number'], ['flags', 'number'], ['reserved', 'number']],
  25: [['simulation_version', 'number'], ['rules_version', 'number'], ['flags', 'number'], ['max_inputs', 'number']],
  28: [['object_id', 'number'], ['component_id', 'number'], ['sample_index', 'number'], ['candidate_index', 'number'],
    ['asset_id', 'bigint']],
  29: [['css_left', 'number'], ['css_top', 'number'], ['css_width', 'number'], ['css_height', 'number'],
    ['device_pixel_ratio', 'number']],
  31: [['state', 'number'], ['epoch', 'number'], ['committed_ms', 'number'], ['presentation_ms', 'number'],
    ['score', 'bigint'], ['accuracy', 'number'], ['health', 'number'], ['combo', 'number'],
    ['highest_combo', 'number'], ['objects_offset', 'number'], ['objects_count', 'number'],
    ['objects_stride', 'number'], ['judgements_offset', 'number'], ['judgements_count', 'number'],
    ['judgements_stride', 'number'], ['batch_token', 'bigint'], ['total_bytes', 'bigint'],
    ['audio_offset', 'number'], ['audio_count', 'number'], ['audio_stride', 'number'], ['reserved', 'number']],
  32: [['state', 'number'], ['epoch', 'number'], ['committed_ms', 'number'], ['presentation_ms', 'number'],
    ['objects_offset', 'number'], ['objects_count', 'number'], ['objects_stride', 'number'], ['reserved', 'number'],
    ['total_bytes', 'bigint'], ['visited_count', 'bigint'], ['revealed_count', 'bigint'], ['cursor_x', 'number'],
    ['cursor_y', 'number']],
  34: [['compact_version', 'number'], ['projection_version', 'number'], ['flags', 'number'], ['reserved', 'number']],
  35: [['resource_id', 'bigint'], ['attachment_version', 'number'], ['flags', 'number'], ['total_bytes', 'bigint'],
    ['prepared_digest_0', 'bigint'], ['prepared_digest_1', 'bigint'], ['prepared_digest_2', 'bigint'],
    ['prepared_digest_3', 'bigint'], ['vertices_offset', 'number'], ['vertices_count', 'number'],
    ['vertices_stride', 'number'], ['vertices_reserved', 'number'], ['indices_offset', 'number'],
    ['indices_count', 'number'], ['indices_stride', 'number'], ['indices_reserved', 'number'],
    ['atlas_offset', 'number'], ['atlas_count', 'number'], ['atlas_stride', 'number'], ['atlas_reserved', 'number'],
    ['vertex_shader_offset', 'number'], ['vertex_shader_count', 'number'], ['vertex_shader_stride', 'number'],
    ['vertex_shader_reserved', 'number'], ['fragment_shader_offset', 'number'], ['fragment_shader_count', 'number'],
    ['fragment_shader_stride', 'number'], ['fragment_shader_reserved', 'number'], ['atlas_width', 'number'],
    ['atlas_height', 'number'], ['reserved', 'bigint']],
  37: [['requested_instances', 'number'], ['required_instances', 'number'], ['required_bytes', 'bigint'],
    ['resource_id', 'bigint'], ['epoch', 'number'], ['flags', 'number']],
  38: [['epoch', 'number'], ['state', 'number'], ['resource_id', 'bigint'], ['presentation_ms', 'number'],
    ['committed_ms', 'number'], ['scale', 'number'], ['client_left', 'number'], ['client_top', 'number'],
    ['score', 'bigint'], ['accuracy', 'number'], ['health', 'number'], ['combo', 'number'],
    ['highest_combo', 'number'], ['instances_offset', 'number'], ['instances_count', 'number'],
    ['instances_stride', 'number'], ['batches_offset', 'number'], ['batches_count', 'number'],
    ['batches_stride', 'number'], ['total_bytes', 'bigint']],
  41: [['resource_version', 'number'], ['circle_animation_version', 'number'], ['draw_version', 'number'],
    ['voice_version', 'number'], ['voice_command_mask', 'number'], ['flags', 'number'],
    ['max_draw_instances', 'number'], ['reserved', 'number']],
  43: [['requested_commands', 'number'], ['required_commands', 'number'], ['required_bytes', 'bigint'],
    ['epoch', 'number'], ['flags', 'number']],
  44: [['epoch', 'number'], ['flags', 'number'], ['batch_token', 'bigint'], ['committed_ms', 'number'],
    ['commands_offset', 'number'], ['commands_count', 'number'], ['commands_stride', 'number'],
    ['reserved', 'number'], ['total_bytes', 'bigint'], ['reserved_tail', 'bigint']],
  45: [['sequence', 'bigint'], ['epoch', 'number'], ['command_kind', 'number'], ['time_ms', 'number'],
    ['voice_id', 'bigint'], ['asset_id', 'bigint'], ['volume', 'number'], ['pan', 'number'], ['rate', 'number'],
    ['duration_ms', 'number'], ['lateness_threshold_ms', 'number'], ['parameter_mask', 'number'],
    ['late_policy', 'number'], ['object_id', 'number'], ['component_id', 'number'], ['flags', 'number'],
    ['reserved', 'number']],
} as const satisfies Record<number, ReadonlyArray<readonly [string, 'number' | 'bigint']>>;

export type Record_Kind = keyof typeof RECORD_FIELD_TYPES;

type Field_List<K extends Record_Kind> = (typeof RECORD_FIELD_TYPES)[K];

export type Typed_Record<K extends Record_Kind> = {
  [Field in Field_List<K>[number] as Field[0]]: Field[1] extends 'number' ? number : bigint
} & { [field: string]: Record_Values };

export type Engine_Capabilities_Record = Typed_Record<4>;
export type Prepared_Descriptor_Record = Typed_Record<8>;
export type Preparation_Capabilities_Record = Typed_Record<14>;
export type Input_Snapshot_Values = Partial<Typed_Record<23>>;
export type Simulation_Capabilities_Record = Typed_Record<25>;
export type Sample_Binding_Values = Typed_Record<28>;
export type Viewport_Values = Typed_Record<29>;
export type Gameplay_Output_Header = Typed_Record<31>;
export type Presentation_Output_Header = Typed_Record<32>;
export type Output_Capabilities_Record = Typed_Record<34>;
export type Render_Resource_Record = Typed_Record<35>;
export type Render_Capacity_Record = Typed_Record<37>;
export type Draw_Output_Header = Typed_Record<38>;
export type Transport_Capabilities_Record = Typed_Record<41>;
export type Voice_Capacity_Record = Typed_Record<43>;
export type Voice_Frame_Record = Typed_Record<44>;
export type Voice_Command_Record = Typed_Record<45>;
export type Scene_Frame_Header = Typed_Record<47>;
export type Scene_Frame_Header_Values = Partial<Scene_Frame_Header>;
export type Sample_Probe_Record = Typed_Record<52>;

const RECORDS = new Map(schema.records.map(record => [record.kind, record]));

export function record_size(kind: number): number {
  const record = RECORDS.get(kind);
  require_condition(record !== undefined, 'UNSUPPORTED', 'Unknown ABI record kind.');
  return record.size;
}

// The generated reader returns the generic record dictionary; the table above
// owns the per-kind field typing. This is the single assertion boundary.
export function read_record<K extends Record_Kind>(view: DataView, offset: number, kind: K): Typed_Record<K> {
  return readRecord(view, offset, kind) as Typed_Record<K>;
}

export interface Engine_Diagnostic {
  kind: 'engine_log';
  file_descriptor: number;
  message: string;
}

// Signatures mirror the oe_* exports declared by engine/abi/records.json and
// docs/architecture/interface-v2.md. Addresses are u64; handles are u64; status is u32.
// Keep in sync with the ABI lifecycle suites when the export surface changes.
export interface Odin_Exports {
  memory: WebAssembly.Memory;
  oe_abi_control(): number;
  oe_engine_create(mailbox_address: number, result_address: number, error_address: number): number;
  oe_engine_capabilities(engine_handle: bigint, result_address: number): number;
  oe_preparation_capabilities(engine_handle: bigint, result_address: number): number;
  oe_simulation_capabilities(engine_handle: bigint, result_address: number): number;
  oe_output_capabilities(engine_handle: bigint, result_address: number): number;
  oe_transport_capabilities(engine_handle: bigint, result_address: number): number;
  oe_buffer_reserve(engine_handle: bigint, kind: number, byte_count: bigint, result_address: number): number;
  oe_map_prepare(engine_handle: bigint, mailbox_address: number, result_address: number, error_address: number): number;
  oe_map_describe(engine_handle: bigint, map_handle: bigint, result_address: number): number;
  oe_scene_capabilities(engine_handle: bigint, result_address: number): number;
  oe_sample_probe(engine_handle: bigint, result_address: number): number;
  oe_map_scene_resources(engine_handle: bigint, map_handle: bigint, result_address: number): number;
  oe_session_scene_resources(engine_handle: bigint, session_handle: bigint, result_address: number): number;
  oe_session_scene_reserve(engine_handle: bigint, session_handle: bigint, mailbox_address: number, result_address: number): number;
  oe_session_scene_draw(engine_handle: bigint, session_handle: bigint, time_ms: number, mailbox_address: number, result_address: number): number;
  oe_map_render_resources(engine_handle: bigint, map_handle: bigint, result_address: number): number;
  oe_map_release(engine_handle: bigint, map_handle: bigint): number;
  oe_playfield_transform(engine_handle: bigint, mailbox_address: number, result_address: number): number;
  oe_session_create(engine_handle: bigint, map_handle: bigint, mailbox_address: number,
    result_address: number, error_address: number): number;
  oe_session_inputs_from_reserved(engine_handle: bigint, session_handle: bigint, token: bigint,
    count: number, error_address: number): number;
  oe_session_bind_sample(engine_handle: bigint, session_handle: bigint, mailbox_address: number): number;
  oe_session_render_resources(engine_handle: bigint, session_handle: bigint, result_address: number): number;
  oe_session_render_reserve(engine_handle: bigint, session_handle: bigint, mailbox_address: number,
    result_address: number): number;
  oe_session_voice_reserve(engine_handle: bigint, session_handle: bigint, mailbox_address: number,
    result_address: number): number;
  oe_session_voice_output(engine_handle: bigint, session_handle: bigint, result_address: number): number;
  oe_session_draw(engine_handle: bigint, session_handle: bigint, time_ms: number,
    mailbox_address: number, result_address: number): number;
  oe_session_advance(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_advance_output(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_presentation(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_snapshot(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_pause(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_resume(engine_handle: bigint, session_handle: bigint, mailbox_address: number): number;
  oe_session_acknowledge(engine_handle: bigint, session_handle: bigint, batch_token: bigint): number;
  oe_session_reset(engine_handle: bigint, session_handle: bigint, lead_in_ms: number): number;
  oe_session_result(engine_handle: bigint, session_handle: bigint, result_address: number): number;
  oe_session_replay_export(engine_handle: bigint, session_handle: bigint, result_address: number): number;
  oe_session_replay_load(engine_handle: bigint, session_handle: bigint, token: bigint, count: number): number;
  oe_session_replay_seek(engine_handle: bigint, session_handle: bigint, time_ms: number,
    result_address: number): number;
  oe_session_release(engine_handle: bigint, session_handle: bigint): number;
  oe_engine_release(engine_handle: bigint): number;
}
