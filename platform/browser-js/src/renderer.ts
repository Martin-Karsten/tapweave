import { Engine_Bridge, Scene_Output } from './engine-bridge.js';
import type { Viewport_Values } from './abi-records.js';
import { WebGL_Resources } from './webgl-resources.js';
import { require_condition } from './errors.js';

// One scene owner; the player supplies time and owns the only RAF/audio clock.
// Borrowed draw output is consumed synchronously before another engine call.
export class Renderer {
  readonly resources;
  readonly output: Scene_Output;
  readonly gpu: WebGL_Resources;
  readonly instance_capacity: number;
  private disposed = false;
  presentation_ms = 0;

  constructor(readonly engine: Engine_Bridge, readonly session_handle: bigint,
    map_handle: bigint, canvas: HTMLCanvasElement, epoch: number,
    readonly on_context_lost: () => void) {
    engine.scene_capabilities();
    this.resources = engine.scene_resources(map_handle);
    const capacity = engine.scene_reserve(session_handle);
    require_condition(capacity.resource_id === this.resources.summary.resource_id && capacity.epoch === epoch,
      'INVALID_DRAW', 'Renderer preparation requires the current session epoch and matching map attachment.');
    engine.scene_reserve(session_handle, capacity.required_instances, capacity.required_bytes);
    this.instance_capacity = capacity.required_instances;
    this.output = new Scene_Output(this.resources, epoch);
    this.gpu = new WebGL_Resources(canvas);
    this.gpu.on_context_lost = on_context_lost;
    try {
      this.gpu.reserve(this.instance_capacity);
      this.gpu.publish(this.resources);
    } catch (error) {
      this.gpu.dispose();
      throw error;
    }
  }

  get ready() { return !this.disposed && this.gpu.scene_ready; }

  render(time_ms: number, viewport: Viewport_Values, epoch: number) {
    require_condition(this.ready, 'INVALID_STATE', 'Renderer requires preparation or recovery.');
    this.output.engine_epoch = epoch;
    const presentation_started = performance.now();
    this.engine.scene_draw(this.session_handle, time_ms, viewport, this.output);
    this.presentation_ms = performance.now() - presentation_started;
    this.gpu.execute(this.output, viewport, epoch, this.gpu.generation);
  }

  restore() {
    require_condition(!this.disposed, 'INVALID_STATE', 'Renderer is disposed.');
    this.gpu.restore();
    this.gpu.reserve(this.instance_capacity);
    // Readiness is returned to the owner; this never resumes the session.
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gpu.dispose();
  }
}
