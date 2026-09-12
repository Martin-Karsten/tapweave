import { Render_Resources } from './render-resources.mjs';
import { require_condition } from './errors.mjs';

// Conservative resource-only admission limits, not measured gameplay defaults.
// Replacement can retain one published set and one candidate (twice these limits).
export const RESOURCE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024,
  vertices: 65536, indices: 196608, atlas_dimension: 1024, shader_bytes: 16384 });

// Owns one map attachment in a dedicated WebGL2 context. All methods are resource
// phase operations; there is deliberately no frame/draw policy in this service.
export class WebGL_Resources {
  #canvas;
  #gl;
  #published = null;
  #retained = null;
  #disposed = false;
  #lost = false;
  #generation = 1;
  #uploads = 0;
  #on_lost;
  #on_restored;

  constructor(canvas) {
    const context = canvas.getContext('webgl2');
    require_condition(context, 'CAP_RENDER_UNAVAILABLE', 'WebGL2 is unavailable.');
    this.#canvas = canvas;
    this.#gl = context;
    this.#on_lost = event => {
      event.preventDefault();
      this.#lost = true;
      this.#published = null; // Context loss itself destroys every GPU object.
      this.#generation++;
    };
    this.#on_restored = () => { this.#lost = false; };
    canvas.addEventListener('webglcontextlost', this.#on_lost);
    canvas.addEventListener('webglcontextrestored', this.#on_restored);
  }

  get generation() { return this.#generation; }
  get upload_count() { return this.#uploads; }
  get ready() { return !this.#disposed && !this.#lost && !this.#gl.isContextLost() && this.#published !== null; }

  #available() {
    if (this.#disposed) require_condition(false, 'INVALID_STATE', 'Render resources are disposed.');
    if (this.#lost || this.#gl.isContextLost()) require_condition(false, 'CAP_RENDER_UNAVAILABLE', 'WebGL2 context is lost.');
  }

  publish(resources) {
    this.#available();
    const bytes = resources.bytes;
    require_condition(bytes instanceof Uint8Array && bytes.byteLength <= RESOURCE_LIMITS.bytes,
      'QUOTA_EXCEEDED', 'Render attachment exceeds the resource byte limit.');
    if (this.#retained && bytes.length === this.#retained.bytes.length &&
      bytes.every((byte, byte_index) => byte === this.#retained.bytes[byte_index])) {
      if (!this.#published) this.#upload(this.#retained);
      return;
    }
    // Own and revalidate bytes: callers can mutate their public reader/copy.
    const candidate = new Render_Resources(bytes.slice());
    this.#validate(candidate);
    this.#upload(candidate);
    this.#retained = candidate;
  }

  restore() {
    this.#available();
    require_condition(this.#retained, 'INVALID_STATE', 'No retained render attachment.');
    if (!this.#published) this.#upload(this.#retained);
  }

  #validate(resources) {
    const summary = resources.summary;
    require_condition(summary.vertices_count <= RESOURCE_LIMITS.vertices && summary.indices_count <= RESOURCE_LIMITS.indices &&
      summary.atlas_width <= RESOURCE_LIMITS.atlas_dimension && summary.atlas_height <= RESOURCE_LIMITS.atlas_dimension &&
      summary.vertex_shader_count <= RESOURCE_LIMITS.shader_bytes && summary.fragment_shader_count <= RESOURCE_LIMITS.shader_bytes,
    'QUOTA_EXCEEDED', 'Render attachment exceeds GPU admission limits.');
    const view = new DataView(resources.bytes.buffer);
    for (let coordinate_index = 0; coordinate_index < summary.vertices_count * 2; coordinate_index++) {
      require_condition(Number.isFinite(Math.fround(view.getFloat64(summary.vertices_offset + coordinate_index * 8, true))),
        'INVALID_RESOURCE', 'Render coordinate exceeds GPU float range.');
    }
  }

  #shader_sources(resources) {
    const summary = resources.summary;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      return ['vertex_shader', 'fragment_shader'].map(span_name => ({
        span_name,
        source: decoder.decode(resources.bytes.subarray(summary[span_name + '_offset'],
          summary[span_name + '_offset'] + summary[span_name + '_count'])),
      }));
    } catch {
      require_condition(false, 'INVALID_RESOURCE', 'Invalid shader UTF-8.');
    }
  }

  #destroy(candidate) {
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

  #upload(resources) {
    const context = this.#gl;
    const summary = resources.summary;
    const shader_sources = this.#shader_sources(resources);
    const candidate = { shaders: [], program: null, vertices: null, indices: null, atlas: null, vertex_array: null };
    const create = (resource) => {
      require_condition(resource, 'RENDER_RESOURCE_FAILED', 'WebGL resource allocation failed.');
      return resource;
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
      candidate.vertex_array = create(context.createVertexArray());
      candidate.vertices = create(context.createBuffer());
      candidate.indices = create(context.createBuffer());
      candidate.atlas = create(context.createTexture());
      const vertices = new Float32Array(summary.vertices_count * 2);
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
      context.vertexAttribPointer(0, 2, context.FLOAT, false, 8, 0);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, candidate.indices);
      context.bufferData(context.ELEMENT_ARRAY_BUFFER, indices, context.STATIC_DRAW);
      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, candidate.atlas);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, summary.atlas_width, summary.atlas_height,
        0, context.RGBA, context.UNSIGNED_BYTE, resources.bytes.subarray(summary.atlas_offset, summary.atlas_offset + summary.atlas_count));
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
  bind(generation, resource_id) {
    this.#available();
    if (!this.#published || generation !== this.#generation || resource_id !== this.#retained.summary.resource_id) {
      require_condition(false, 'INVALID_STATE', 'Render generation is unavailable.');
    }
    this.#gl.useProgram(this.#published.program);
    this.#gl.bindVertexArray(this.#published.vertex_array);
    this.#gl.activeTexture(this.#gl.TEXTURE0);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#published.atlas);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#canvas.removeEventListener('webglcontextlost', this.#on_lost);
    this.#canvas.removeEventListener('webglcontextrestored', this.#on_restored);
    if (this.#published) this.#destroy(this.#published);
    this.#published = null;
    this.#retained = null;
  }
}
