import { Render_Resources, type Render_Resource_Snapshot } from './render-resources.js';
import type { Scene_Output } from './engine-bridge.js';
import type { Viewport_Values, Record_Values } from './abi-records.js';
import { SCENE_PRIMITIVE, SCENE_INSTANCE_FLAG_CLIPPING_CAP, SCENE_ATTACHMENT_MAGIC } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';

// Instance staging slots, one f32 each: 16 slots = 64 bytes = one instance row.
// Slot order mirrors the kind-50 scene instance record consumed by the shaders.
const INSTANCE_SLOT = Object.freeze({ X: 0, Y: 1, SCALE_X: 2, SCALE_Y: 3, ROTATION: 4, ALPHA: 5,
  PRIMITIVE: 6, PROGRESS: 7, COLOUR_RED: 8, COLOUR_GREEN: 9, COLOUR_BLUE: 10, COLOUR_ALPHA: 11,
  CLIP_START: 12, CLIP_END: 13, GLYPH: 14, FLAGS: 15 } as const);
const INSTANCE_FLOAT_STRIDE = 16;
const INSTANCE_BYTE_STRIDE = 64;
const INSTANCE_ATTRIBUTE_ROW_BYTES = 16; // one vec4 attribute row; four fill an instance
const INDEX_ELEMENT_BYTES = 4; // u32 element indices
// Command staging slots, one u32 each: 4 slots = one instanced-draw command.
const COMMAND_SLOT = Object.freeze({ FIRST_INSTANCE: 0, INSTANCE_COUNT: 1, GEOMETRY_FIRST: 2, GEOMETRY_COUNT: 3 } as const);
const COMMAND_WORD_STRIDE = 4;
const MAX_VIEWPORT_DIMENSION = 16384;
const MAX_VIEWPORT_PIXELS = 16777216;
// Ring of GPU timing queries so no frame stalls on a previous result.
const GPU_QUERY_COUNT = 4;

// The single backing-buffer size calculation: admission checks and the actual
// canvas allocation both call this, so they can never disagree. Oversized
// physical dimensions reduce backing resolution uniformly while the CSS
// rectangle — and therefore input mapping — stays unchanged.
export function framebuffer_size(viewport: Viewport_Values): { width: number; height: number } {
  const physical_width = Math.max(1, Math.round(viewport.css_width * viewport.device_pixel_ratio));
  const physical_height = Math.max(1, Math.round(viewport.css_height * viewport.device_pixel_ratio));
  if (physical_width <= MAX_VIEWPORT_DIMENSION && physical_height <= MAX_VIEWPORT_DIMENSION &&
      physical_width * physical_height <= MAX_VIEWPORT_PIXELS) {
    return { width: physical_width, height: physical_height };
  }
  const reduction = Math.min(MAX_VIEWPORT_DIMENSION / physical_width, MAX_VIEWPORT_DIMENSION / physical_height,
    Math.sqrt(MAX_VIEWPORT_PIXELS / (physical_width * physical_height)));
  return { width: Math.max(1, Math.floor(physical_width * reduction)),
    height: Math.max(1, Math.floor(physical_height * reduction)) };
}

// Conservative resource-only admission limits, not measured gameplay defaults.
// Replacement can retain one published set and one candidate (twice these limits).
export const RESOURCE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024,
  vertices: 65536, indices: 196608, atlas_dimension: 1024, shader_bytes: 16384 });

export const SCENE_LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024, vertices: 2000000,
  indices: 6000000, atlas_dimension: 1024, shader_bytes: 16384,
  instances: 1000000, commands: 1000000, upload_bytes: 64000000 });

interface Uploaded_Candidate {
  transform: WebGLUniformLocation | null;
  sampler: WebGLUniformLocation | null;
  program: WebGLProgram | null;
  shaders: WebGLShader[];
  vertices: WebGLBuffer | null;
  indices: WebGLBuffer | null;
  atlas: WebGLTexture | null;
  vertex_array: WebGLVertexArrayObject | null;
}

export type Render_Publish_Input = Render_Resources | { bytes: Uint8Array };
type Retained_Attachment = Render_Resource_Snapshot | Render_Resources;

// Owns one map attachment in a dedicated WebGL2 context. All methods are resource
// operations and validated command submission; presentation policy remains in Odin.
export class WebGL_Resources {
  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #published: Uploaded_Candidate | null = null;
  #retained: Retained_Attachment | null = null;
  #disposed = false;
  #lost = false;
  #generation = 1;
  #uploads = 0;
  #on_lost: (event: Event) => void;
  #on_restored: () => void;
  #dynamic: WebGLBuffer | null = null;
  #staging = new Float32Array(0);
  #commands = new Uint32Array(0);
  #instance: Record<string, Record_Values> = {};
  #batch: Record<string, Record_Values> = {};
  #timer_extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  #queries: WebGLQuery[] = [];
  #query_pending = new Uint8Array(4);
  #query_cursor = 0;
  #query_invalid = new Uint8Array(4);
  on_context_lost: (() => void) | null = null;
  readonly metrics = { validation_ms: 0, upload_ms: 0, submission_ms: 0, instances: 0, commands: 0,
    dynamic_bytes: 0, static_bytes: 0, gpu_ms: null as number | null, gpu_sequence: 0 };

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', { stencil: true, alpha: false });
    require_condition(context, 'CAP_RENDER_UNAVAILABLE', 'WebGL2 is unavailable.');
    this.#canvas = canvas;
    this.#gl = context!;
    this.#on_lost = event => {
      event.preventDefault();
      this.#lost = true;
      this.#published = null; // Context loss itself destroys every GPU object.
      this.#generation++;
      this.#dynamic = null;
      this.#queries.length = 0;
      this.#query_pending.fill(0);
      this.metrics.gpu_ms = null;
      this.on_context_lost?.();
    };
    this.#on_restored = () => { this.#lost = false; };
    canvas.addEventListener('webglcontextlost', this.#on_lost);
    canvas.addEventListener('webglcontextrestored', this.#on_restored);
  }

  get generation() { return this.#generation; }
  get scene_ready() { return this.ready && this.#dynamic !== null && this.#retained?.scene === true; }
  get upload_count() { return this.#uploads; }
  get ready() { return !this.#disposed && !this.#lost && !this.#gl.isContextLost() && this.#published !== null; }

  #available() {
    if (this.#disposed) require_condition(false, 'INVALID_STATE', 'Render resources are disposed.');
    if (this.#lost || this.#gl.isContextLost()) require_condition(false, 'CAP_RENDER_UNAVAILABLE', 'WebGL2 context is lost.');
  }

  publish(resources: Render_Publish_Input) {
    this.#available();
    const bytes = resources.bytes;
    // A scene attachment begins with the little-endian scene_resource kind.
    const scene_header = bytes instanceof Uint8Array && bytes.length >= 2 &&
      bytes[0] === SCENE_ATTACHMENT_MAGIC && bytes[1] === 0;
    require_condition(bytes instanceof Uint8Array && bytes.byteLength <= (scene_header ? SCENE_LIMITS.bytes : RESOURCE_LIMITS.bytes),
      'QUOTA_EXCEEDED', 'Render attachment exceeds the resource byte limit.');
    // Own a private copy. A validated attachment is never re-parsed; raw byte
    // bundles take the full reader path once.
    const candidate = resources instanceof Render_Resources
      ? resources.own_snapshot()
      : new Render_Resources(bytes.slice());
    const retained = this.#retained;
    if (retained && candidate.bytes.length === retained.bytes.length &&
      candidate.bytes.every((byte, byte_index) => byte === retained.bytes[byte_index])) {
      if (!this.#published) this.#upload(retained);
      return;
    }
    this.#validate(candidate);
    this.#upload(candidate);
    this.#retained = candidate;
    this.metrics.static_bytes = candidate.bytes.byteLength;
  }

  restore() {
    this.#available();
    require_condition(this.#retained, 'INVALID_STATE', 'No retained render attachment.');
    if (!this.#published) this.#upload(this.#retained!);
  }

  #validate(resources: Retained_Attachment) {
    const summary = resources.summary;
    const limits = resources.scene ? SCENE_LIMITS : RESOURCE_LIMITS;
    const floats_per_vertex = resources.scene ? 4 : 2;
    require_condition(resources.bytes.length <= limits.bytes, 'QUOTA_EXCEEDED', 'Resource byte limit exceeded.');
    require_condition(summary.vertices_count <= limits.vertices && summary.indices_count <= limits.indices &&
      summary.atlas_width <= limits.atlas_dimension && summary.atlas_height <= limits.atlas_dimension &&
      summary.vertex_shader_count <= limits.shader_bytes && summary.fragment_shader_count <= limits.shader_bytes,
      'QUOTA_EXCEEDED', 'Render attachment exceeds GPU admission limits.');
    const view = new DataView(resources.bytes.buffer);
    for (let coordinate_index = 0; coordinate_index < summary.vertices_count * floats_per_vertex; coordinate_index++) {
      require_condition(Number.isFinite(Math.fround(view.getFloat64(summary.vertices_offset + coordinate_index * 8, true))),
        'INVALID_RESOURCE', 'Render coordinate exceeds GPU float range.');
    }
  }

  #shader_sources(resources: Retained_Attachment) {
    const summary = resources.summary;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const span_names = ['vertex_shader', 'fragment_shader'] as const;
      return span_names.map(span_name => ({
        span_name,
        source: decoder.decode(resources.bytes.subarray(summary[`${span_name}_offset`],
          summary[`${span_name}_offset`] + summary[`${span_name}_count`])),
      }));
    } catch {
      throw new Browser_Error('INVALID_RESOURCE', 'Invalid shader UTF-8.');
    }
  }

  #destroy(candidate: Uploaded_Candidate) {
    const context = this.#gl;
    // Deletion is deferred while a program is current. Preserve a different
    // published program when destroying a failed replacement candidate.
    if (candidate.program && context.getParameter(context.CURRENT_PROGRAM) === candidate.program) {
      context.useProgram(null);
    }
    for (const shader of candidate.shaders) context.deleteShader(shader);
    context.deleteProgram(candidate.program);
    context.deleteBuffer(candidate.vertices);
    context.deleteBuffer(candidate.indices);
    context.deleteTexture(candidate.atlas);
    context.deleteVertexArray(candidate.vertex_array);
  }

  #upload(resources: Retained_Attachment) {
    const context = this.#gl;
    const shader_sources = this.#shader_sources(resources);
    const candidate: Uploaded_Candidate = { transform: null, sampler: null, shaders: [], program: null, vertices: null, indices: null,
      atlas: null, vertex_array: null };
    const create = <Resource>(resource: Resource | null): Resource => {
      require_condition(resource, 'RENDER_RESOURCE_FAILED', 'WebGL resource allocation failed.');
      return resource!;
    };
    try {
      this.#require_upload_capacity(context, resources);
      this.#build_shader_program(candidate, shader_sources, resources, create);
      this.#upload_static_resources(candidate, resources, create);
      const previous = this.#published;
      this.#published = candidate;
      this.#uploads++;
      if (previous) this.#destroy(previous);
    } catch (error) {
      this.#destroy(candidate);
      throw error;
    } finally {
      context.bindVertexArray(null);
      context.bindBuffer(context.ARRAY_BUFFER, null);
      context.bindTexture(context.TEXTURE_2D, null);
    }
  }

  #require_upload_capacity(context: WebGL2RenderingContext, resources: Retained_Attachment) {
    const summary = resources.summary;
    require_condition(context.getError() === context.NO_ERROR, 'RENDER_RESOURCE_FAILED', 'WebGL has a pending error.');
    require_condition(summary.atlas_width <= context.getParameter(context.MAX_TEXTURE_SIZE) &&
      summary.atlas_height <= context.getParameter(context.MAX_TEXTURE_SIZE),
      'CAP_RENDER_UNAVAILABLE', 'Atlas exceeds the context texture limit.');
  }

  #build_shader_program(candidate: Uploaded_Candidate, shader_sources: { span_name: string; source: string }[],
    resources: Retained_Attachment, create: <Resource>(resource: Resource | null) => Resource) {
    const context = this.#gl;
    for (const { span_name, source } of shader_sources) {
      const shader_type = span_name === 'vertex_shader' ? context.VERTEX_SHADER : context.FRAGMENT_SHADER;
      const shader = create(context.createShader(shader_type));
      candidate.shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
        require_condition(false, 'RENDER_RESOURCE_FAILED', 'Render shader compilation failed.',
          { stage: span_name, info_log: context.getShaderInfoLog(shader) ?? '' });
      }
    }
    candidate.program = create(context.createProgram());
    for (const shader of candidate.shaders) context.attachShader(candidate.program, shader);
    context.linkProgram(candidate.program);
    if (!context.getProgramParameter(candidate.program, context.LINK_STATUS)) {
      require_condition(false, 'RENDER_RESOURCE_FAILED', 'Render program linking failed.',
        { stage: 'link', info_log: context.getProgramInfoLog(candidate.program) ?? '' });
    }
    if (resources.scene) {
      require_condition(context.getContextAttributes()?.stencil, 'CAP_RENDER_UNAVAILABLE', 'Scene rendering requires stencil coverage.');
      candidate.transform = context.getUniformLocation(candidate.program, 'viewport_transform');
      candidate.sampler = context.getUniformLocation(candidate.program, 'glyph_atlas');
      require_condition(candidate.transform !== null && candidate.sampler !== null,
        'INVALID_RESOURCE', 'Scene shader interface is incomplete.');
    }
  }

  #upload_static_resources(candidate: Uploaded_Candidate, resources: Retained_Attachment,
    create: <Resource>(resource: Resource | null) => Resource) {
    const context = this.#gl;
    const summary = resources.summary;
    const floats_per_vertex = resources.scene ? 4 : 2;
    candidate.vertex_array = create(context.createVertexArray());
    candidate.vertices = create(context.createBuffer());
    candidate.indices = create(context.createBuffer());
    candidate.atlas = create(context.createTexture());
    const vertices = new Float32Array(summary.vertices_count * floats_per_vertex);
    const indices = new Uint32Array(summary.indices_count);
    const view = new DataView(resources.bytes.buffer);
    for (let coordinate_index = 0; coordinate_index < vertices.length; coordinate_index++) {
      vertices[coordinate_index] = view.getFloat64(summary.vertices_offset + coordinate_index * 8, true);
    }
    for (let index_index = 0; index_index < indices.length; index_index++) {
      indices[index_index] = view.getUint32(summary.indices_offset + index_index * INDEX_ELEMENT_BYTES, true);
    }
    context.bindVertexArray(candidate.vertex_array);
    context.bindBuffer(context.ARRAY_BUFFER, candidate.vertices);
    context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, floats_per_vertex, context.FLOAT, false, floats_per_vertex * Float32Array.BYTES_PER_ELEMENT, 0);
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, candidate.indices);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, indices, context.STATIC_DRAW);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, candidate.atlas);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, summary.atlas_width, summary.atlas_height,
      0, context.RGBA, context.UNSIGNED_BYTE, resources.bytes.subarray(summary.atlas_offset,
        summary.atlas_offset + summary.atlas_count));
    require_condition(!context.isContextLost() && context.getError() === context.NO_ERROR,
      'RENDER_RESOURCE_FAILED', 'Render resource upload failed.');
  }

  // Bind only; a future validated command executor owns submission. No handles
  // escape, so a stale generation cannot accidentally bind deleted resources.
  bind(generation: number, resource_id: bigint) {
    this.#available();
    if (!this.#published || generation !== this.#generation || resource_id !== this.#retained!.summary.resource_id) {
      require_condition(false, 'INVALID_STATE', 'Render generation is unavailable.');
    }
    this.#gl.useProgram(this.#published!.program);
    this.#gl.bindVertexArray(this.#published!.vertex_array);
    this.#gl.activeTexture(this.#gl.TEXTURE0);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#published!.atlas);
  }

  reserve(instance_capacity: number) {
    this.#available();
    require_condition(Number.isSafeInteger(instance_capacity) && instance_capacity > 0 &&
      instance_capacity <= SCENE_LIMITS.instances, 'QUOTA_EXCEEDED', 'Invalid scene capacity.');
    if (this.#dynamic && this.#staging.length === instance_capacity * INSTANCE_FLOAT_STRIDE) return;
    const staging = new Float32Array(instance_capacity * INSTANCE_FLOAT_STRIDE);
    const commands = new Uint32Array(instance_capacity * COMMAND_WORD_STRIDE);
    const context = this.#gl;
    const candidate = context.createBuffer();
    require_condition(candidate, 'RENDER_RESOURCE_FAILED', 'Dynamic buffer allocation failed.');
    try {
      context.bindBuffer(context.ARRAY_BUFFER, candidate);
      context.bufferData(context.ARRAY_BUFFER, staging.byteLength, context.DYNAMIC_DRAW);
      require_condition(!context.isContextLost() && context.getError() === context.NO_ERROR,
        'RENDER_RESOURCE_FAILED', 'Dynamic reserve failed.');
    } catch (error) {
      context.deleteBuffer(candidate);
      throw error;
    }
    context.deleteBuffer(this.#dynamic);
    this.#dynamic = candidate;
    this.#staging = staging;
    this.#commands = commands;
    for (const query of this.#queries) context.deleteQuery(query);
    this.#queries.length = 0;
    this.#query_pending.fill(0);
    this.#query_invalid.fill(0);
    this.#query_cursor = 0;
    this.#timer_extension = context.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.#timer_extension) {
      for (let query_index = 0; query_index < GPU_QUERY_COUNT; query_index++) {
        const query = context.createQuery();
        if (!query) {
          for (const retained_query of this.#queries) context.deleteQuery(retained_query);
          this.#queries.length = 0;
          break;
        }
        this.#queries.push(query);
      }
    }
  }

  // Stage the entire borrowed frame before making any GL call. Instance and
  // command policy is validated by the engine at emit time; this executor
  // checks transport identity, capacity and finiteness only.
  execute(frame: Scene_Output, viewport: Viewport_Values, epoch: number, generation: number) {
    this.#available();
    const validation_started = performance.now();
    this.#validate_scene_submission(frame, viewport, epoch, generation);
    this.#stage_instances(frame);
    const covered_instances = this.#stage_batches(frame);
    require_condition(covered_instances === frame.instances.count, 'INVALID_DRAW', 'Incomplete scene batches.');
    const submission_started = performance.now();
    this.metrics.validation_ms = submission_started - validation_started;
    const context = this.#gl;
    this.bind(generation, frame.summary.resource_id);
    const measured_query = this.#begin_gpu_timing(context);
    this.#configure_render_state(viewport, frame.summary);
    const upload_started = performance.now();
    if (covered_instances) {
      context.bufferSubData(context.ARRAY_BUFFER, 0, this.#staging, 0, covered_instances * INSTANCE_FLOAT_STRIDE);
    }
    this.metrics.upload_ms = performance.now() - upload_started;
    this.#draw_batches(context, frame);
    if (measured_query >= 0) this.#end_gpu_timing(context, measured_query);
    require_condition(!context.isContextLost() && context.getError() === context.NO_ERROR, 'RENDER_RESOURCE_FAILED', 'Scene submission failed.');
    this.metrics.submission_ms = performance.now() - submission_started - this.metrics.upload_ms;
    this.metrics.instances = covered_instances;
    this.metrics.commands = frame.batches.count;
    this.metrics.dynamic_bytes = covered_instances * INSTANCE_BYTE_STRIDE;
  }

  // Transport identity, admission capacity, viewport and uniform finiteness.
  #validate_scene_submission(frame: Scene_Output, viewport: Viewport_Values, epoch: number, generation: number) {
    const resources = this.#retained;
    require_condition(this.#published && this.#dynamic && resources?.scene && frame.valid &&
      frame.resources.scene && frame.summary.resource_id === resources.summary.resource_id &&
      frame.summary.epoch === epoch && epoch === frame.engine_epoch && generation === this.#generation,
      'INVALID_DRAW', 'Scene identity or dynamic reserve is unavailable.');
    require_condition(
      frame.instances.count * INSTANCE_FLOAT_STRIDE <= this.#staging.length &&
      frame.batches.count * COMMAND_WORD_STRIDE <= this.#commands.length,
      'QUOTA_EXCEEDED', 'Scene exceeds reserved submission capacity.');
    require_condition(Number.isFinite(viewport.css_left) && Number.isFinite(viewport.css_top) &&
      Number.isFinite(viewport.css_width) && viewport.css_width > 0 &&
      Number.isFinite(viewport.css_height) && viewport.css_height > 0 &&
      Number.isFinite(viewport.device_pixel_ratio) && viewport.device_pixel_ratio > 0,
      'INVALID_DRAW', 'Invalid viewport.');
    const pixels = framebuffer_size(viewport);
    require_condition(pixels.width > 0 && pixels.height > 0 && pixels.width <= MAX_VIEWPORT_DIMENSION &&
      pixels.height <= MAX_VIEWPORT_DIMENSION && pixels.width * pixels.height <= MAX_VIEWPORT_PIXELS,
      'QUOTA_EXCEEDED', 'Canvas dimensions exceed admission.');
    // The engine publishes f32-exact NDC uniforms with the frame; the executor
    // uploads them without re-deriving presentation math.
    require_condition(Number.isFinite(frame.summary.uniform_scale_x) && Number.isFinite(frame.summary.uniform_scale_y) &&
      Number.isFinite(frame.summary.uniform_shift_x) && Number.isFinite(frame.summary.uniform_shift_y),
      'INVALID_DRAW', 'Viewport uniforms exceed GPU float range.');
  }

  // Copy every borrowed instance into the CPU staging row before drawing.
  #stage_instances(frame: Scene_Output) {
    for (let instance_index = 0; instance_index < frame.instances.count; instance_index++) {
      const instance = frame.record_into(frame.instances, instance_index, this.#instance);
      const offset = instance_index * INSTANCE_FLOAT_STRIDE;
      const colour = Number(instance.colour);
      this.#staging[offset + INSTANCE_SLOT.X] = Number(instance.x);
      this.#staging[offset + INSTANCE_SLOT.Y] = Number(instance.y);
      this.#staging[offset + INSTANCE_SLOT.SCALE_X] = Number(instance.scale_x);
      this.#staging[offset + INSTANCE_SLOT.SCALE_Y] = Number(instance.scale_y);
      this.#staging[offset + INSTANCE_SLOT.ROTATION] = Number(instance.rotation);
      this.#staging[offset + INSTANCE_SLOT.ALPHA] = Number(instance.alpha);
      this.#staging[offset + INSTANCE_SLOT.PRIMITIVE] = Number(instance.primitive);
      this.#staging[offset + INSTANCE_SLOT.PROGRESS] = Number(instance.progress);
      // Colour is packed low-byte red through high-byte alpha.
      this.#staging[offset + INSTANCE_SLOT.COLOUR_RED] = (colour & 255) / 255;
      this.#staging[offset + INSTANCE_SLOT.COLOUR_GREEN] = ((colour >>> 8) & 255) / 255;
      this.#staging[offset + INSTANCE_SLOT.COLOUR_BLUE] = ((colour >>> 16) & 255) / 255;
      this.#staging[offset + INSTANCE_SLOT.COLOUR_ALPHA] = (colour >>> 24) / 255;
      this.#staging[offset + INSTANCE_SLOT.CLIP_START] = Number(instance.clip_start);
      this.#staging[offset + INSTANCE_SLOT.CLIP_END] = Number(instance.clip_end);
      this.#staging[offset + INSTANCE_SLOT.GLYPH] = Number(instance.glyph);
      this.#staging[offset + INSTANCE_SLOT.FLAGS] = Number(instance.flags);
      for (let scalar_index = offset; scalar_index < offset + INSTANCE_FLOAT_STRIDE; scalar_index++) {
        require_condition(Number.isFinite(this.#staging[scalar_index]), 'INVALID_DRAW', 'Non-finite GPU instance.');
      }
    }
  }

  // Validate batch coverage and emit one command row per batch.
  #stage_batches(frame: Scene_Output) {
    let covered_instances = 0;
    for (let batch_index = 0; batch_index < frame.batches.count; batch_index++) {
      const batch = frame.record_into(frame.batches, batch_index, this.#batch);
      const first_instance = Number(batch.first_instance), instance_count = Number(batch.instance_count);
      require_condition(first_instance === covered_instances && instance_count > 0 &&
        instance_count <= frame.instances.count - covered_instances,
        'INVALID_DRAW', 'Invalid scene batch coverage.');
      const first_member = frame.record_into(frame.instances, first_instance, this.#instance);
      const geometry_first = Number(first_member.geometry_first), geometry_count = Number(first_member.geometry_count);
      const command_offset = batch_index * COMMAND_WORD_STRIDE;
      this.#commands[command_offset + COMMAND_SLOT.FIRST_INSTANCE] = first_instance;
      this.#commands[command_offset + COMMAND_SLOT.INSTANCE_COUNT] = instance_count;
      this.#commands[command_offset + COMMAND_SLOT.GEOMETRY_FIRST] = geometry_first;
      this.#commands[command_offset + COMMAND_SLOT.GEOMETRY_COUNT] = geometry_count;
      covered_instances += instance_count;
    }
    return covered_instances;
  }

  // Consume the oldest timing query result and begin a new measurement when the
  // ring has a free slot. Returns the measured query index, or -1 when untimed.
  #begin_gpu_timing(context: WebGL2RenderingContext) {
    if (!this.#timer_extension || !this.#queries.length) return -1;
    const query_index = this.#query_cursor;
    this.#query_cursor = (query_index + 1) % this.#queries.length;
    const query = this.#queries[query_index];
    const disjoint = context.getParameter(this.#timer_extension.GPU_DISJOINT_EXT);
    if (disjoint) {
      this.metrics.gpu_ms = null;
      // Every outstanding interval may span the disjoint event, even when
      // its result only becomes available on a later, non-disjoint frame.
      for (let pending_index = 0; pending_index < this.#queries.length; pending_index++) {
        if (this.#query_pending[pending_index]) this.#query_invalid[pending_index] = 1;
      }
    }
    if (this.#query_pending[query_index] && context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) {
      if (!disjoint && !this.#query_invalid[query_index]) {
        this.metrics.gpu_ms = Number(context.getQueryParameter(query, context.QUERY_RESULT)) / 1000000;
        this.metrics.gpu_sequence++;
      }
      this.#query_pending[query_index] = 0;
    }
    if (!this.#query_pending[query_index]) {
      this.#query_invalid[query_index] = disjoint ? 1 : 0;
      context.beginQuery(this.#timer_extension.TIME_ELAPSED_EXT, query);
      return query_index;
    }
    return -1;
  }

  #end_gpu_timing(context: WebGL2RenderingContext, measured_query: number) {
    context.endQuery(this.#timer_extension!.TIME_ELAPSED_EXT);
    this.#query_pending[measured_query] = 1;
  }

  // Fixed per-frame raster state plus the engine's f32-exact NDC uniforms.
  #configure_render_state(viewport: Viewport_Values, summary: Scene_Output['summary']) {
    const context = this.#gl;
    // Same centralized calculation the admission check used.
    const pixels = framebuffer_size(viewport);
    if (this.#canvas.width !== pixels.width) this.#canvas.width = pixels.width;
    if (this.#canvas.height !== pixels.height) this.#canvas.height = pixels.height;
    context.viewport(0, 0, pixels.width, pixels.height);
    context.disable(context.DEPTH_TEST);
    context.disable(context.CULL_FACE);
    context.disable(context.SCISSOR_TEST);
    context.stencilMask(255);
    context.clearStencil(0);
    context.clearColor(0, 0, 0, 1);
    context.clear(context.COLOR_BUFFER_BIT | context.STENCIL_BUFFER_BIT);
    context.enable(context.BLEND);
    context.blendEquation(context.FUNC_ADD);
    context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
    context.uniform4f(this.#published!.transform, summary.uniform_scale_x,
      summary.uniform_scale_y, summary.uniform_shift_x, summary.uniform_shift_y);
    context.uniform1i(this.#published!.sampler, 0);
    context.bindBuffer(context.ARRAY_BUFFER, this.#dynamic);
  }

  // Submit the staged commands. Paths open stencil coverage; clipping caps
  // continue the previous path's coverage instead of clearing it.
  #draw_batches(context: WebGL2RenderingContext, frame: Scene_Output) {
    for (let batch_index = 0; batch_index < frame.batches.count; batch_index++) {
      const command_offset = batch_index * COMMAND_WORD_STRIDE;
      const first_instance = this.#commands[command_offset + COMMAND_SLOT.FIRST_INSTANCE];
      const path = this.#staging[first_instance * INSTANCE_FLOAT_STRIDE + INSTANCE_SLOT.PRIMITIVE] === SCENE_PRIMITIVE.PATH;
      const continuation = this.#staging[first_instance * INSTANCE_FLOAT_STRIDE + INSTANCE_SLOT.FLAGS] ===
        SCENE_INSTANCE_FLAG_CLIPPING_CAP;
      if (path || continuation) {
        if (path) context.clear(context.STENCIL_BUFFER_BIT);
        context.enable(context.STENCIL_TEST);
        context.stencilFunc(context.EQUAL, 0, 255);
        context.stencilOp(context.KEEP, context.KEEP, context.INCR);
      } else context.disable(context.STENCIL_TEST);
      for (let attribute = 1; attribute <= 4; attribute++) {
        context.enableVertexAttribArray(attribute);
        context.vertexAttribPointer(attribute, 4, context.FLOAT, false, INSTANCE_BYTE_STRIDE,
          first_instance * INSTANCE_BYTE_STRIDE + (attribute - 1) * INSTANCE_ATTRIBUTE_ROW_BYTES);
        context.vertexAttribDivisor(attribute, 1);
      }
      context.drawElementsInstanced(context.TRIANGLES,
        this.#commands[command_offset + COMMAND_SLOT.GEOMETRY_COUNT], context.UNSIGNED_INT,
        this.#commands[command_offset + COMMAND_SLOT.GEOMETRY_FIRST] * INDEX_ELEMENT_BYTES,
        this.#commands[command_offset + COMMAND_SLOT.INSTANCE_COUNT]);
    }
    context.disable(context.STENCIL_TEST);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const query of this.#queries) this.#gl.deleteQuery(query);
    this.#queries.length = 0;
    this.#gl.deleteBuffer(this.#dynamic);
    this.#dynamic = null;
    this.#staging = new Float32Array(0);
    this.#commands = new Uint32Array(0);
    this.#canvas.removeEventListener('webglcontextlost', this.#on_lost);
    this.#canvas.removeEventListener('webglcontextrestored', this.#on_restored);
    if (this.#published) this.#destroy(this.#published);
    this.#published = null;
    this.#retained = null;
  }
}
