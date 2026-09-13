import { Render_Resources, type Render_Resource_Snapshot } from './render-resources.js';
import type { Scene_Output } from './engine-bridge.js';
import type { Viewport_Values, Record_Values } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';

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
// phase operations; there is deliberately no frame/draw policy in this service.
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
  #timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  #queries: WebGLQuery[] = [];
  #query_pending = new Uint8Array(4);
  #query_cursor = 0;
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
    const scene_header = bytes instanceof Uint8Array && bytes.length >= 2 && bytes[0] === 46 && bytes[1] === 0;
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
    require_condition(resources.bytes.length <= limits.bytes, 'QUOTA_EXCEEDED', 'Resource byte limit exceeded.');
    require_condition(summary.vertices_count <= limits.vertices && summary.indices_count <= limits.indices &&
      summary.atlas_width <= limits.atlas_dimension && summary.atlas_height <= limits.atlas_dimension &&
      summary.vertex_shader_count <= limits.shader_bytes && summary.fragment_shader_count <= limits.shader_bytes,
      'QUOTA_EXCEEDED', 'Render attachment exceeds GPU admission limits.');
    const view = new DataView(resources.bytes.buffer);
    for (let coordinate_index = 0; coordinate_index < summary.vertices_count * (resources.scene ? 4 : 2); coordinate_index++) {
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
    const summary = resources.summary;
    const shader_sources = this.#shader_sources(resources);
    const candidate: Uploaded_Candidate = { transform: null, sampler: null, shaders: [], program: null, vertices: null, indices: null,
      atlas: null, vertex_array: null };
    const create = <Resource>(resource: Resource | null): Resource => {
      require_condition(resource, 'RENDER_RESOURCE_FAILED', 'WebGL resource allocation failed.');
      return resource!;
    };
    try {
      require_condition(context.getError() === context.NO_ERROR, 'RENDER_RESOURCE_FAILED', 'WebGL has a pending error.');
      require_condition(summary.atlas_width <= context.getParameter(context.MAX_TEXTURE_SIZE) &&
        summary.atlas_height <= context.getParameter(context.MAX_TEXTURE_SIZE),
        'CAP_RENDER_UNAVAILABLE', 'Atlas exceeds the context texture limit.');
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
      candidate.vertex_array = create(context.createVertexArray());
      candidate.vertices = create(context.createBuffer());
      candidate.indices = create(context.createBuffer());
      candidate.atlas = create(context.createTexture());
      const vertices = new Float32Array(summary.vertices_count * (resources.scene ? 4 : 2));
      const indices = new Uint32Array(summary.indices_count);
      const view = new DataView(resources.bytes.buffer);
      for (let coordinate_index = 0; coordinate_index < vertices.length; coordinate_index++) {
        vertices[coordinate_index] = view.getFloat64(summary.vertices_offset + coordinate_index * 8, true);
      }
      for (let index_index = 0; index_index < indices.length; index_index++) {
        indices[index_index] = view.getUint32(summary.indices_offset + index_index * 4, true);
      }
      context.bindVertexArray(candidate.vertex_array);
      context.bindBuffer(context.ARRAY_BUFFER, candidate.vertices);
      context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);
      context.enableVertexAttribArray(0);
      context.vertexAttribPointer(0, resources.scene ? 4 : 2, context.FLOAT, false, resources.scene ? 16 : 8, 0);
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
    if (this.#dynamic && this.#staging.length === instance_capacity * 16) return;
    const staging = new Float32Array(instance_capacity * 16);
    const commands = new Uint32Array(instance_capacity * 4);
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
    this.#timer = context.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.#timer) {
      for (let query_index = 0; query_index < 4; query_index++) {
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

  // Validate and stage the entire borrowed frame before making any GL call.
  execute(frame: Scene_Output, viewport: Viewport_Values, epoch: number, generation: number) {
    this.#available();
    const validation_started = performance.now();
    const resources = this.#retained;
    require_condition(this.#published && this.#dynamic && resources?.scene && frame.valid &&
      frame.resources.scene && frame.summary.resource_id === resources.summary.resource_id &&
      frame.summary.epoch === epoch && epoch === frame.engine_epoch && generation === this.#generation,
      'INVALID_DRAW', 'Scene identity or dynamic reserve is unavailable.');
    const summary = frame.summary;
    require_condition(frame.instances.count * 16 <= this.#staging.length && frame.batches.count * 4 <= this.#commands.length,
      'QUOTA_EXCEEDED', 'Scene exceeds reserved submission capacity.');
    require_condition(Number.isFinite(viewport.css_left) && Number.isFinite(viewport.css_top) &&
      Number.isFinite(viewport.css_width) && viewport.css_width > 0 &&
      Number.isFinite(viewport.css_height) && viewport.css_height > 0 &&
      Number.isFinite(viewport.device_pixel_ratio) && viewport.device_pixel_ratio > 0 &&
      Number.isFinite(summary.scale) && summary.scale > 0 && Number.isFinite(summary.client_left) && Number.isFinite(summary.client_top),
      'INVALID_DRAW', 'Invalid viewport.');
    const pixel_width = Math.round(viewport.css_width * viewport.device_pixel_ratio);
    const pixel_height = Math.round(viewport.css_height * viewport.device_pixel_ratio);
    require_condition(pixel_width > 0 && pixel_height > 0 && pixel_width <= 16384 && pixel_height <= 16384 && pixel_width * pixel_height <= 16777216,
      'QUOTA_EXCEEDED', 'Canvas dimensions exceed admission.');
    const scale_x = Math.fround(2 * summary.scale / viewport.css_width);
    const scale_y = Math.fround(-2 * summary.scale / viewport.css_height);
    const shift_x = Math.fround(2 * (summary.client_left - viewport.css_left) / viewport.css_width - 1);
    const shift_y = Math.fround(1 - 2 * (summary.client_top - viewport.css_top) / viewport.css_height);
    require_condition(Number.isFinite(scale_x) && Number.isFinite(scale_y) && Number.isFinite(shift_x) && Number.isFinite(shift_y),
      'INVALID_DRAW', 'Viewport exceeds GPU float range.');
    let coverage_object = -1;
    for (let instance_index = 0; instance_index < frame.instances.count; instance_index++) {
      const instance = frame.record_into(frame.instances, instance_index, this.#instance);
      const primitive = Number(instance.primitive);
      const first = Number(instance.geometry_first), count = Number(instance.geometry_count);
      require_condition(primitive >= 1 && primitive <= 5 && (instance.flags === 0 || instance.flags === 1 && primitive === 1) && instance.reserved === 0n &&
        first % 3 === 0 && count > 0 && count % 3 === 0 && first <= resources!.summary.indices_count &&
        count <= resources!.summary.indices_count - first &&
        (primitive === 4 || first === 0 && count === 6) &&
        Number(instance.alpha) >= 0 && Number(instance.alpha) <= 1 &&
        Number(instance.scale_x) >= 0 && Number(instance.scale_y) >= 0 &&
        Number(instance.clip_start) >= 0 && Number(instance.clip_end) <= 1 && Number(instance.clip_start) <= Number(instance.clip_end) &&
        (primitive !== 3 || Number(instance.glyph) < 128), 'INVALID_DRAW', 'Invalid scene instance.');
      if (instance.flags === 1) {
        require_condition(coverage_object === Number(instance.object_id) && instance.layer === 10,
          'INVALID_DRAW', 'A clipping cap must immediately follow its path coverage.');
      } else coverage_object = primitive === 4 ? Number(instance.object_id) : -1;
      const offset = instance_index * 16;
      const colour = Number(instance.colour);
      this.#staging[offset] = Number(instance.x);
      this.#staging[offset + 1] = Number(instance.y);
      this.#staging[offset + 2] = Number(instance.scale_x);
      this.#staging[offset + 3] = Number(instance.scale_y);
      this.#staging[offset + 4] = Number(instance.rotation);
      this.#staging[offset + 5] = Number(instance.alpha);
      this.#staging[offset + 6] = primitive;
      this.#staging[offset + 7] = Number(instance.progress);
      this.#staging[offset + 8] = (colour & 255) / 255;
      this.#staging[offset + 9] = ((colour >>> 8) & 255) / 255;
      this.#staging[offset + 10] = ((colour >>> 16) & 255) / 255;
      this.#staging[offset + 11] = (colour >>> 24) / 255;
      this.#staging[offset + 12] = Number(instance.clip_start);
      this.#staging[offset + 13] = Number(instance.clip_end);
      this.#staging[offset + 14] = Number(instance.glyph);
      this.#staging[offset + 15] = Number(instance.flags);
      for (let scalar_index = offset; scalar_index < offset + 16; scalar_index++) {
        require_condition(Number.isFinite(this.#staging[scalar_index]), 'INVALID_DRAW', 'Non-finite GPU instance.');
      }
    }
    let covered_instances = 0;
    for (let batch_index = 0; batch_index < frame.batches.count; batch_index++) {
      const batch = frame.record_into(frame.batches, batch_index, this.#batch);
      const first_instance = Number(batch.first_instance), instance_count = Number(batch.instance_count);
      require_condition(first_instance === covered_instances && instance_count > 0 &&
        instance_count <= frame.instances.count - covered_instances && batch.reserved === 0n,
        'INVALID_DRAW', 'Invalid scene batch coverage.');
      frame.record_into(frame.instances, first_instance, this.#instance);
      const geometry_first = Number(this.#instance.geometry_first), geometry_count = Number(this.#instance.geometry_count);
      require_condition(batch.primitive !== 4 || instance_count === 1, 'INVALID_DRAW', 'A path requires independent stencil coverage.');
      for (let member_index = first_instance; member_index < first_instance + instance_count; member_index++) {
        frame.record_into(frame.instances, member_index, this.#instance);
        require_condition((batch.primitive === 0 && this.#instance.primitive !== 4 || batch.primitive === 4 && this.#instance.primitive === 4) && this.#instance.layer === batch.layer &&
          this.#instance.geometry_first === geometry_first && this.#instance.geometry_count === geometry_count,
          'INVALID_DRAW', 'Batch references incompatible instances.');
      }
      const command_offset = batch_index * 4;
      this.#commands[command_offset] = first_instance;
      this.#commands[command_offset + 1] = instance_count;
      this.#commands[command_offset + 2] = geometry_first;
      this.#commands[command_offset + 3] = geometry_count;
      covered_instances += instance_count;
    }
    require_condition(covered_instances === frame.instances.count, 'INVALID_DRAW', 'Incomplete scene batches.');
    const submission_started = performance.now();
    this.metrics.validation_ms = submission_started - validation_started;
    const context = this.#gl;
    this.bind(generation, summary.resource_id);
    let measured_query = -1;
    if (this.#timer && this.#queries.length) {
      const query_index = this.#query_cursor;
      this.#query_cursor = (query_index + 1) % this.#queries.length;
      const query = this.#queries[query_index];
      const disjoint = context.getParameter(this.#timer.GPU_DISJOINT_EXT);
      if (disjoint) this.metrics.gpu_ms = null;
      if (this.#query_pending[query_index] && context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) {
        if (!disjoint) {
          this.metrics.gpu_ms = Number(context.getQueryParameter(query, context.QUERY_RESULT)) / 1000000;
          this.metrics.gpu_sequence++;
        }
        this.#query_pending[query_index] = 0;
      }
      if (!this.#query_pending[query_index]) {
        context.beginQuery(this.#timer.TIME_ELAPSED_EXT, query);
        measured_query = query_index;
      }
    }
    if (this.#canvas.width !== pixel_width) this.#canvas.width = pixel_width;
    if (this.#canvas.height !== pixel_height) this.#canvas.height = pixel_height;
    context.viewport(0, 0, pixel_width, pixel_height);
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
    context.uniform4f(this.#published!.transform, scale_x, scale_y, shift_x, shift_y);
    context.uniform1i(this.#published!.sampler, 0);
    context.bindBuffer(context.ARRAY_BUFFER, this.#dynamic);
    const upload_started = performance.now();
    if (covered_instances) context.bufferSubData(context.ARRAY_BUFFER, 0, this.#staging, 0, covered_instances * 16);
    this.metrics.upload_ms = performance.now() - upload_started;
    for (let batch_index = 0; batch_index < frame.batches.count; batch_index++) {
      const command_offset = batch_index * 4;
      const first_instance = this.#commands[command_offset];
      const path = this.#staging[first_instance * 16 + 6] === 4;
      const continuation = this.#staging[first_instance * 16 + 15] === 1;
      if (path || continuation) {
        if (path) context.clear(context.STENCIL_BUFFER_BIT);
        context.enable(context.STENCIL_TEST);
        context.stencilFunc(context.EQUAL, 0, 255);
        context.stencilOp(context.KEEP, context.KEEP, context.INCR);
      } else context.disable(context.STENCIL_TEST);
      for (let attribute = 1; attribute <= 4; attribute++) {
        context.enableVertexAttribArray(attribute);
        context.vertexAttribPointer(attribute, 4, context.FLOAT, false, 64, first_instance * 64 + (attribute - 1) * 16);
        context.vertexAttribDivisor(attribute, 1);
      }
      context.drawElementsInstanced(context.TRIANGLES, this.#commands[command_offset + 3], context.UNSIGNED_INT,
        this.#commands[command_offset + 2] * 4, this.#commands[command_offset + 1]);
    }
    context.disable(context.STENCIL_TEST);
    if (measured_query >= 0) {
      context.endQuery(this.#timer!.TIME_ELAPSED_EXT);
      this.#query_pending[measured_query] = 1;
    }
    require_condition(!context.isContextLost() && context.getError() === context.NO_ERROR, 'RENDER_RESOURCE_FAILED', 'Scene submission failed.');
    this.metrics.submission_ms = performance.now() - submission_started - this.metrics.upload_ms;
    this.metrics.instances = covered_instances;
    this.metrics.commands = frame.batches.count;
    this.metrics.dynamic_bytes = covered_instances * 64;
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
