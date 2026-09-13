import { Engine_Bridge } from './engine-bridge.js';
import { Audio_Playback } from './audio-playback.js';
import { Gameplay_Frame } from './gameplay-frame.js';
import { Renderer } from './renderer.js';
import { create_synthetic_context, type Synthetic_Audio_Context } from './synthetic-context.js';
import { create_fallback_audio } from './fallback-audio.js';
import { load_sample_assets, type Loaded_Samples } from './sample-assets.js';
import { Diagnostics_Service } from './diagnostics.js';
import { SESSION_STATE } from './abi-records.js';
import { Browser_Error } from './errors.js';

// Developer-workspace scenario corpus shared between the browser runner and
// Node regression tests. The listing/search/run-controls structure takes its
// inspiration from the pinned osu!framework TestBrowser; each scenario executes
// through the production WASM engine and production browser services. Fault
// injection exists only here, never in the player.

export type Debug_Scenario_Group = 'clock' | 'delivery' | 'input' | 'lifecycle' | 'audio' | 'graphics';

export interface Debug_Scenario_Input_Event {
  time_ms: number;
  x: number;
  y: number;
  action_bits: number;
  source: string;
  held: boolean;
}

export interface Debug_Scenario_Parameters {
  rate_hz?: number;
  stall_ms?: number;
  clock_skew_ms?: number;
  end_ms?: number;
  input_capacity?: number;
  pause_at_ms?: number;
  reject_audio_start?: boolean;
  suspend_audio_at_ms?: number;
  fail_dispatch_at_ms?: number;
  maximum_voices?: number;
  maximum_pending?: number;
  lose_graphics_at_ms?: number;
  fail_scene_dispatch_at_ms?: number;
  scene_instance_capacity?: number;
  real_audio?: boolean;
}

export interface Debug_Scenario_Expectations {
  final_state?: number;
  committed_reaches_ms?: number;
  engine_failures?: number;
  failure_status?: string;
  input_rejected_batches?: number;
  mapped_time_ms?: { sequence: number; mapped_time_ms: number }[];
  input_action_bits?: number[];
  attempts?: number;
  audio_starts?: number;
  audio_interruptions?: number;
  graphics_restorations?: number;
  clock_rebindings?: number;
}

export interface Debug_Scenario_Definition {
  id: string;
  title: string;
  description: string;
  group: Debug_Scenario_Group;
  synthetic: boolean;
  requires_user_gesture: boolean;
  parameters: Debug_Scenario_Parameters;
  inputs: Debug_Scenario_Input_Event[];
  expects: Debug_Scenario_Expectations;
}

export const DEBUG_SCENARIO_MAP = `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
ApproachRate:5
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1500,1,0
256,192,2500,2,0,L|356:192,1,100
256,192,3500,8,0,4500`;

const SLIDER_SPAN_MS = 100 / 0.28;

// A fixed hit script: circle press, tracked slider hold with moves, spinner hold.
function default_script(): Debug_Scenario_Input_Event[] {
  const script: Debug_Scenario_Input_Event[] = [
    { time_ms: 1495, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: true },
    { time_ms: 1515, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: false },
    { time_ms: 2495, x: 256, y: 192, action_bits: 1, source: 'mouse:0', held: true },
  ];
  for (let move_time = 2600; move_time <= 2850; move_time += 50) {
    const progress = (move_time - 2500) / SLIDER_SPAN_MS;
    script.push({ time_ms: move_time, x: Math.fround(256 + 100 * Math.min(1, progress)), y: 192,
      action_bits: 0, source: 'mouse:0', held: true });
  }
  script.push({ time_ms: 2870, x: 356, y: 192, action_bits: 1, source: 'mouse:0', held: false });
  script.push({ time_ms: 3495, x: 256, y: 192, action_bits: 2, source: 'KeyX', held: true });
  script.push({ time_ms: 4480, x: 256, y: 192, action_bits: 2, source: 'KeyX', held: false });
  return script.sort((first, second) => first.time_ms - second.time_ms);
}

const scenario = (definition: Partial<Debug_Scenario_Definition> & Pick<Debug_Scenario_Definition, 'id' | 'title' | 'description' | 'group'>): Debug_Scenario_Definition => ({
  synthetic: true, requires_user_gesture: false, parameters: {}, inputs: default_script(), expects: {},
  ...definition });

export function debug_scenarios(): Debug_Scenario_Definition[] {
  const definitions: Debug_Scenario_Definition[] = [];
  const mapped_first_two = (skew_ms: number) => [{ sequence: 1, mapped_time_ms: 1495 + skew_ms },
    { sequence: 2, mapped_time_ms: 1515 + skew_ms }];
  definitions.push(scenario({ id: 'clock-aligned', group: 'clock', title: 'Aligned clocks',
    description: 'Receipt and audio timelines agree; every scripted input maps to its exact beatmap time and the run passes.',
    parameters: { clock_skew_ms: 0 },
    expects: { final_state: SESSION_STATE.PASSED, engine_failures: 0, input_rejected_batches: 0,
      mapped_time_ms: mapped_first_two(0) } }));
  for (const skew_ms of [2, 10]) {
    definitions.push(scenario({ id: `clock-late-${skew_ms}`, group: 'clock', title: `Receipt clock +${skew_ms} ms late`,
      description: `The receipt timeline runs ${skew_ms} ms ahead of the audio anchor; mapped input times shift by exactly +${skew_ms} ms.`,
      parameters: { clock_skew_ms: skew_ms },
      expects: { final_state: SESSION_STATE.PASSED, engine_failures: 0, mapped_time_ms: mapped_first_two(skew_ms) } }));
    definitions.push(scenario({
      id: `clock-early-${skew_ms}`, group: 'clock', title: `Receipt clock -${skew_ms} ms early`,
      description: skew_ms === 10 ?
        `A -${skew_ms} ms receipt skew maps inputs early; at 60 Hz any scripted input within ${skew_ms} ms after a frame boundary (the slider release at 2870 ms is 3.3 ms after one) maps before the committed time and the engine rejects the batch. The report retains the exact lateness.` :
        `The receipt timeline trails the audio anchor by ${skew_ms} ms; mapped input times shift by exactly -${skew_ms} ms.`,
      parameters: { clock_skew_ms: -skew_ms },
      expects: skew_ms === 10 ?
        { engine_failures: 1, failure_status: 'ENGINE_7', input_rejected_batches: 1 } :
        { final_state: SESSION_STATE.PASSED, engine_failures: 0, mapped_time_ms: mapped_first_two(-skew_ms) } }));
  }
  definitions.push(scenario({ id: 'clock-mismatch-rejection', group: 'clock', title: 'Clock mismatch rejects a late batch',
    description: 'A -400 ms receipt skew maps the first input before the committed time; the engine rejects the batch with LATE_INPUT and the report retains exact timestamps and lateness.',
    parameters: { clock_skew_ms: -400 },
    expects: { engine_failures: 1, failure_status: 'ENGINE_7', input_rejected_batches: 1 } }));
  for (const rate_hz of [30, 60, 120, 144]) {
    definitions.push(scenario({ id: `delivery-${rate_hz}hz`, group: 'delivery', title: `${rate_hz} Hz delivery`,
      description: `Frame callbacks arrive at ${rate_hz} Hz without stalls; the run passes and results match the direct schedule.`,
      parameters: { rate_hz },
      expects: { final_state: SESSION_STATE.PASSED, committed_reaches_ms: 4500, engine_failures: 0 } }));
  }
  for (const stall_ms of [50, 100, 250]) {
    definitions.push(scenario({ id: `delivery-stall-${stall_ms}`, group: 'delivery', title: `60 Hz with a ${stall_ms} ms stall`,
      description: `One frame callback is delayed by ${stall_ms} ms mid-run; batched delivery must not change the final result.`,
      parameters: { rate_hz: 60, stall_ms },
      expects: { final_state: SESSION_STATE.PASSED, committed_reaches_ms: 4500, engine_failures: 0 } }));
  }
  definitions.push(scenario({ id: 'input-aggregation', group: 'input', title: 'Keyboard and mouse aggregation',
    description: 'A key press and a mouse press at the same receipt aggregate action bits through the production input buffer.',
    inputs: [{ time_ms: 1490, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: true },
      { time_ms: 1490, x: 256, y: 192, action_bits: 2, source: 'mouse:2', held: true },
      { time_ms: 1515, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: false },
      { time_ms: 1515, x: 256, y: 192, action_bits: 2, source: 'mouse:2', held: false }],
    expects: { input_action_bits: [1, 3, 2, 0], final_state: SESSION_STATE.PASSED } }));
  definitions.push(scenario({ id: 'input-release-all', group: 'input', title: 'Release-all cancels held sources',
    description: 'A blur-equivalent release-all record clears every held source through one action_bits-zero snapshot.',
    inputs: [{ time_ms: 1490, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: true },
      { time_ms: 1490, x: 256, y: 192, action_bits: 2, source: 'KeyX', held: true }],
    parameters: { end_ms: 2200 },
    expects: { input_action_bits: [1, 3, 0], final_state: SESSION_STATE.PAUSED } }));
  definitions.push(scenario({ id: 'input-queue-rejected', group: 'input', title: 'Full input queue rejects a batch',
    description: 'A two-record queue capacity overflows when three inputs arrive between frames; the rejection is recorded without corrupting the session.',
    inputs: [{ time_ms: 1490, x: 256, y: 192, action_bits: 1, source: 'KeyZ', held: true },
      { time_ms: 1490, x: 256, y: 192, action_bits: 1, source: 'mouse:0', held: true },
      { time_ms: 1490, x: 256, y: 192, action_bits: 2, source: 'KeyX', held: true }],
    parameters: { input_capacity: 2, end_ms: 2200 },
    expects: { engine_failures: 1, failure_status: 'QUOTA_EXCEEDED' } }));
  definitions.push(scenario({ id: 'lifecycle-pause-resume', group: 'lifecycle', title: 'Pause and resume at the circle',
    description: 'The frame driver drains and pauses at 1600 ms; resuming rebinds the session clock and completes the run.',
    parameters: { pause_at_ms: 1600 },
    expects: { final_state: SESSION_STATE.PASSED, clock_rebindings: 2, engine_failures: 0 } }));
  definitions.push(scenario({ id: 'lifecycle-rejected-start-retry', group: 'lifecycle', title: 'Rejected audio start then retry',
    description: 'AudioContext.resume rejects the first start; an isolated retry resets the session and completes the run.',
    parameters: { reject_audio_start: true },
    expects: { attempts: 2, final_state: SESSION_STATE.PASSED, engine_failures: 1 } }));
  definitions.push(scenario({ id: 'lifecycle-audio-suspension', group: 'lifecycle', title: 'Audio suspension interrupts playback',
    description: 'The context suspends mid-run; the next pump records the interruption and recovery without a judgement change.',
    parameters: { suspend_audio_at_ms: 2000 },
    expects: { engine_failures: 1, input_rejected_batches: 0, audio_interruptions: 1, failure_status: 'INVALID_STATE' } }));
  definitions.push(scenario({ id: 'audio-dispatch-failure', group: 'audio', title: 'Sample dispatch failure',
    description: 'A buffer-source creation failure during a judgement pump cancels queued playback and records the failure.',
    parameters: { fail_dispatch_at_ms: 1550 },
    expects: { engine_failures: 1 } }));
  definitions.push(scenario({ id: 'audio-capacity-exhaustion', group: 'audio', title: 'Voice capacity exhaustion',
    description: 'A single-voice executor quota rejects overlapping sample dispatch; the engine journals remain consistent.',
    parameters: { maximum_voices: 1 },
    expects: { engine_failures: 1, failure_status: 'QUOTA_EXCEEDED' } }));
  definitions.push(scenario({ id: 'audio-real-start', group: 'audio', title: 'Real audible start (user gesture)',
    description: 'Starts music and hitsounds on the real AudioContext; requires the Run click as the user gesture.',
    synthetic: false, requires_user_gesture: true, parameters: { real_audio: true },
    expects: { audio_starts: 1, final_state: SESSION_STATE.PASSED } }));
  definitions.push(scenario({ id: 'graphics-loss-restoration', group: 'graphics', title: 'GPU context loss and restoration',
    description: 'WEBGL_lose_context drops the GPU mid-run; explicit restoration republishes resources and the run completes.',
    synthetic: false, requires_user_gesture: false, parameters: { lose_graphics_at_ms: 1600 },
    expects: { graphics_restorations: 1, final_state: SESSION_STATE.PASSED, engine_failures: 0 } }));
  definitions.push(scenario({ id: 'graphics-dispatch-failure', group: 'graphics', title: 'Scene dispatch failure',
    description: 'An injected scene-draw failure surfaces through the frame driver and records the operation name.',
    synthetic: false, requires_user_gesture: false, parameters: { fail_scene_dispatch_at_ms: 1600 },
    expects: { engine_failures: 1, failure_status: 'INVALID_DRAW' } }));
  definitions.push(scenario({ id: 'graphics-capacity-exhaustion', group: 'graphics', title: 'Scene capacity exhaustion',
    description: 'A one-instance scene reservation cannot hold the mixed scene; the engine rejects the transactional reservation instead of drawing partially.',
    synthetic: false, requires_user_gesture: false, parameters: { scene_instance_capacity: 1 },
    expects: { engine_failures: 1, failure_status: 'ENGINE_4' } }));
  return definitions;
}

export interface Scenario_Assertion_Result {
  description: string;
  passed: boolean;
  observed: string;
}

export interface Scenario_Run_Summary {
  definition: Debug_Scenario_Definition;
  completed: boolean;
  final_state: number | null;
  score: string | null;
  committed_ms: number | null;
  audio_starts: number | null;
  assertions: Scenario_Assertion_Result[];
  failure_status: string | null;
}

export interface Scenario_Run_Options {
  diagnostics?: Diagnostics_Service;
  canvas?: HTMLCanvasElement | null;
  create_renderer?: typeof Renderer | null;
  on_step?: (summary: Scenario_Run_Summary) => void;
  on_event?: (message: string) => void;
}

// One executable scenario run over production engine paths with an injected
// clock. Synthetic scenarios are fully deterministic; graphics and real-audio
// scenarios require a browser context supplied by the workspace.
export class Debug_Scenario_Run {
  readonly diagnostics: Diagnostics_Service;
  readonly definition: Debug_Scenario_Definition;
  private engine: Engine_Bridge | null = null;
  private playback: Audio_Playback | null = null;
  private frame: Gameplay_Frame | null = null;
  private renderer: Renderer | null = null;
  private synthetic: Synthetic_Audio_Context | null = null;
  private real_context: AudioContext | null = null;
  private map_handle: bigint | null = null;
  private session_handle: bigint | null = null;
  private samples: Loaded_Samples | null = null;
  private music_buffer: AudioBuffer | null = null;
  private context: AudioContext | null = null;
  private frame_callbacks = new Map<number, FrameRequestCallback>();
  private next_callback_id = 0;
  private elapsed_ms = 0;
  private frame_index = 0;
  private started = false;
  private done = false;
  private stalled = false;
  private script_index = 0;
  private released_all = false;
  private readonly end_ms: number;
  private readonly rate_hz: number;
  private readonly interval_ms: number;
  private audio_starts = 0;

  private constructor(readonly wasm_bytes: Uint8Array, definition: Debug_Scenario_Definition,
    private readonly options: Scenario_Run_Options) {
    this.diagnostics = options.diagnostics ?? new Diagnostics_Service();
    this.definition = definition;
    this.end_ms = definition.parameters.end_ms ?? 5000;
    this.rate_hz = definition.parameters.rate_hz ?? 60;
    this.interval_ms = 1000 / this.rate_hz;
  }

  static async create(wasm_bytes: Uint8Array, definition: Debug_Scenario_Definition,
    options: Scenario_Run_Options = {}): Promise<Debug_Scenario_Run> {
    const run = new Debug_Scenario_Run(wasm_bytes, definition, options);
    await run.initialize();
    return run;
  }

  private async initialize() {
    this.diagnostics.capture_mode = 'detailed';
    this.engine = await Engine_Bridge.create(this.wasm_bytes, { diagnostics: this.diagnostics });
    const map = this.engine.prepare_map(new TextEncoder().encode(DEBUG_SCENARIO_MAP));
    this.map_handle = map.map_handle;
    const capacity = this.definition.parameters.input_capacity;
    this.session_handle = this.engine.create_session(this.map_handle, capacity ?
      { input_capacity: capacity, batch_capacity: capacity, arena_bytes: 4n * 1024n * 1024n } : {});
    if (this.definition.parameters.real_audio) {
      if (typeof AudioContext === 'undefined') throw new Browser_Error('UNSUPPORTED', 'Real-audio scenarios require a browser workspace.');
      this.real_context = new AudioContext();
      this.synthetic = null;
    } else if (this.definition.group === 'graphics' && !this.options.canvas?.getContext) {
      throw new Browser_Error('UNSUPPORTED', 'Graphics scenarios require a browser workspace with a WebGL2 canvas.');
    } else {
      this.synthetic = create_synthetic_context(0);
    }
    this.context = this.real_context ?? this.synthetic!.context;
    this.samples = await load_sample_assets(map.descriptor,
      { async read() { return null; }, async decode_music() { throw new Error('Scenario maps carry no encoded music.'); } },
      'scenario.osu', async () => { throw new Error('Scenario maps carry no encoded music.'); },
      this.engine.sample_probe(), { fallback_assets: create_fallback_audio(this.context) });
    this.music_buffer = this.context.createBuffer(1, Math.ceil(6 * this.context.sampleRate), this.context.sampleRate);
    await this.create_playback();
    this.diagnostics.begin_attempt();
  }

  private async create_playback() {
    if (this.definition.parameters.fail_scene_dispatch_at_ms !== undefined) {
      const engine = this.engine!;
      const original_draw = engine.scene_draw.bind(engine);
      const diagnostics = this.diagnostics;
      engine.scene_draw = (session_handle: bigint, time_ms: number, viewport: never, output: never) => {
        if (this.elapsed_ms >= this.definition.parameters.fail_scene_dispatch_at_ms!) {
          diagnostics.record_engine_failure('oe_session_scene_draw',
            new Browser_Error('INVALID_DRAW', 'Injected scene dispatch failure.'), { time_ms });
          throw new Browser_Error('INVALID_DRAW', 'Injected scene dispatch failure.');
        }
        return original_draw(session_handle, time_ms, viewport, output);
      };
    }
    this.playback = new Audio_Playback(this.engine!, this.session_handle!, this.context!,
      { music_buffer: this.music_buffer!, samples: this.samples! }, {
        maximum_voices: this.definition.parameters.maximum_voices,
        maximum_pending: this.definition.parameters.maximum_pending,
      }, false, this.diagnostics);
    this.frame = new Gameplay_Frame(this.playback, (time_ms, output) => {
      this.renderer?.render(time_ms, this.viewport(), output.summary.epoch);
    }, capacity_guard(this.definition.parameters.input_capacity),
      callback => { this.frame_callbacks.set(++this.next_callback_id, callback); return this.next_callback_id; },
      identifier => { this.frame_callbacks.delete(identifier); },
      { diagnostics: this.diagnostics });
    this.frame.on_terminal = () => { this.done = true; };
  }

  private viewport() {
    const canvas_bounds = this.options.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1024, height: 768 };
    return { css_left: canvas_bounds.left, css_top: canvas_bounds.top, css_width: canvas_bounds.width,
      css_height: canvas_bounds.height, device_pixel_ratio: this.options.canvas?.ownerDocument?.defaultView?.devicePixelRatio ?? 1 };
  }

  // True receipt timeline used for clock binding; scripted input stamps apply
  // the deliberate skew separately so mapped times stay exact.
  private receipt_now = () => this.elapsed_ms;

  async start() {
    if (this.started) throw new Browser_Error('INVALID_STATE', 'Scenario already started.');
    this.started = true;
    const context = this.real_context ?? this.synthetic!.context;
    if (this.definition.parameters.reject_audio_start) this.synthetic!.faults.reject_resume = true;
    if (this.definition.group === 'graphics' && this.options.canvas) {
      this.renderer = new (this.options.create_renderer ?? Renderer)(this.engine!, this.session_handle!, this.map_handle!,
        this.options.canvas, Number(this.engine!.snapshot(this.session_handle!, 0).summary.epoch), () => {});
      if (this.definition.parameters.scene_instance_capacity !== undefined) {
        try {
          this.engine!.scene_reserve(this.session_handle!, this.definition.parameters.scene_instance_capacity);
        } catch (capacity_error) {
          // The engine rejects an insufficient reservation transactionally; the
          // scenario concludes with that rejection recorded.
          this.diagnostics.record_event('graphics', 'error', 'oe_session_scene_reserve',
            'Scene capacity shortfall rejected the reservation.',
            { scenario_concluded: true, failure_status: capacity_error instanceof Error && 'code' in capacity_error ?
              String((capacity_error as { code?: unknown }).code) : null });
          this.done = true;
          return;
        }
      }
    }
    try {
      await this.playback!.start(0, this.receipt_now);
      this.audio_starts++;
    } catch (first_error) {
      if (!this.definition.parameters.reject_audio_start) throw first_error;
      this.diagnostics.record_event('lifecycle', 'warning', 'scenario_retry',
        'First audio start rejected; retrying after session reset.');
      this.synthetic!.faults.reject_resume = false;
      this.playback!.dispose();
      this.engine!.reset_session(this.session_handle!);
      await this.create_playback();
      this.diagnostics.begin_attempt();
      await this.playback!.start(0, this.receipt_now);
      this.audio_starts++;
    }
    this.frame!.start();
  }

  // Advance one frame: apply the configured stall once mid-run, deliver scripted
  // inputs whose mapped time has arrived, then run scheduled callbacks. Frame
  // times derive from frame_index * interval (plus applied stalls) so repeated
  // float addition cannot drift a frame boundary below a scripted input time.
  async step(): Promise<boolean> {
    if (!this.started) await this.start();
    const state_before_frame = this.playback!.state;
    if (this.done || state_before_frame === 'recovering' || state_before_frame === 'disposed') return true;
    this.frame_index++;
    const stall_ms = !this.stalled && this.definition.parameters.stall_ms !== undefined &&
      this.frame_index >= 30 ? (this.stalled = true, this.definition.parameters.stall_ms) : 0;
    const previous_elapsed_ms = this.elapsed_ms;
    this.elapsed_ms = this.frame_index * this.interval_ms + (this.stalled ? this.definition.parameters.stall_ms! : 0);
    if (this.synthetic) this.synthetic.advance((this.elapsed_ms - previous_elapsed_ms) / 1000);
    this.apply_scripted_controls();
    await this.apply_scripted_faults();
    const scheduled = [...this.frame_callbacks.values()];
    this.frame_callbacks.clear();
    for (const callback of scheduled) callback(this.elapsed_ms);
    const state_after_frame = this.playback!.state;
    if (state_after_frame === 'recovering') return true;
    if (this.definition.parameters.pause_at_ms !== undefined && !this.paused_once &&
      this.elapsed_ms >= this.definition.parameters.pause_at_ms) {
      this.paused_once = true;
      this.frame!.pause();
      await this.playback!.start(0, this.receipt_now);
      this.frame!.start();
    }
    if (this.elapsed_ms >= this.end_ms) await this.finish();
    return this.done;
  }

  private paused_once = false;

  private apply_scripted_controls() {
    const skew_ms = this.definition.parameters.clock_skew_ms ?? 0;
    while (this.script_index < this.definition.inputs.length &&
      this.elapsed_ms >= this.definition.inputs[this.script_index].time_ms) {
      const event = this.definition.inputs[this.script_index];
      if (event.source === 'release_all') {
        this.frame!.input.release_all(this.receipt_now());
        this.released_all = true;
      } else {
        // The scripted press happens at time_ms; the receipt stamp carries the
        // deliberate clock skew so the mapped time is exactly time_ms + skew.
        try {
          this.frame!.input.receive({ source_id: event.source, action: event.action_bits,
            held: event.held, raw_time_ms: event.time_ms + skew_ms,
            client_x: event.x, client_y: event.y, inverse_transform: IDENTITY_TRANSFORM });
        } catch (error) {
          this.diagnostics.record_engine_failure('input_queue_receive', error,
            { script_index: this.script_index, source: event.source });
        }
      }
      this.script_index++;
    }
    if (this.definition.id === 'input-release-all' && !this.released_all && this.elapsed_ms >= 1600) {
      this.frame!.input.release_all(this.receipt_now());
      this.released_all = true;
    }
  }

  private async apply_scripted_faults() {
    const parameters = this.definition.parameters;
    if (parameters.suspend_audio_at_ms !== undefined && this.synthetic &&
      this.elapsed_ms >= parameters.suspend_audio_at_ms && !this.suspended_once) {
      this.suspended_once = true;
      this.synthetic.set_state('suspended');
    }
    if (parameters.fail_dispatch_at_ms !== undefined && this.synthetic &&
      this.elapsed_ms >= parameters.fail_dispatch_at_ms && !this.dispatch_failed_once) {
      this.dispatch_failed_once = true;
      this.synthetic.faults.fail_next_buffer_source = true;
    }
    if (parameters.lose_graphics_at_ms !== undefined && this.renderer && !this.graphics_cycled &&
      this.elapsed_ms >= parameters.lose_graphics_at_ms) {
      this.graphics_cycled = true;
      const webgl_context = this.options.canvas!.getContext('webgl2') as WebGL2RenderingContext & {
        getExtension(name: 'WEBGL_lose_context'): { loseContext(): void; restoreContext(): void } | null };
      const lose_extension = webgl_context.getExtension('WEBGL_lose_context');
      if (lose_extension) {
        lose_extension.loseContext();
        await wait_for_graphics_event(this.options.canvas!, 'webglcontextlost');
        this.diagnostics.note_graphics_event('error', 'Graphics context lost (scenario injection).');
        // Chromium rejects restoreContext inside the loss dispatch task; defer
        // to a later task before requesting restoration.
        await new Promise(resolve => setTimeout(resolve, 50));
        lose_extension.restoreContext();
        await wait_for_graphics_event(this.options.canvas!, 'webglcontextrestored');
        this.renderer.restore();
        this.diagnostics.note_graphics_event('info', 'Graphics context restored and resources republished (scenario injection).');
      }
    }
  }

  private suspended_once = false;
  private dispatch_failed_once = false;
  private graphics_cycled = false;

  private async finish() {
    if (this.playback!.state === 'running') {
      try {
        this.frame!.pause();
      } catch { /* Terminal or recovering states conclude on their own. */ }
    }
    this.done = true;
  }

  async run_to_completion() {
    const maximum_frames = Math.ceil(this.end_ms / this.interval_ms) + 64;
    for (let frame_index = 0; frame_index < maximum_frames; frame_index++) {
      if (await this.step()) break;
    }
    return this.collect();
  }

  summary_state(): Scenario_Run_Summary {
    return { definition: this.definition, completed: this.done,
      final_state: this.result_state(), score: this.result_score(),
      committed_ms: this.playback?.last_committed_ms ?? null,
      audio_starts: this.synthetic ? this.audio_starts : null,
      assertions: this.assertions(), failure_status: this.diagnostics.first_failure?.status ?? null };
  }

  collect(): Scenario_Run_Summary {
    const summary = this.summary_state();
    this.options.on_step?.(summary);
    return summary;
  }

  private result_state() {
    if (!this.session_handle || !this.engine) return null;
    try {
      return Number(this.engine.snapshot(this.session_handle, this.end_ms).summary.state);
    } catch {
      return null;
    }
  }

  private result_score() {
    if (!this.session_handle || !this.engine) return null;
    try {
      return this.engine.snapshot(this.session_handle, this.end_ms).summary.score.toString();
    } catch {
      return null;
    }
  }

  private assertions(): Scenario_Assertion_Result[] {
    const expects = this.definition.expects;
    const results: Scenario_Assertion_Result[] = [];
    const observe = (description: string, passed: boolean, observed: unknown) =>
      results.push({ description, passed, observed: typeof observed === 'number' ? String(observed) : JSON.stringify(observed ?? null) });
    if (expects.final_state !== undefined) {
      observe(`final session state ${state_name(expects.final_state)}`, this.result_state() === expects.final_state, state_name(this.result_state()));
    }
    if (expects.committed_reaches_ms !== undefined) {
      observe(`committed time reaches ${expects.committed_reaches_ms} ms`,
        (this.playback?.last_committed_ms ?? -1) >= expects.committed_reaches_ms, this.playback?.last_committed_ms);
    }
    if (expects.engine_failures !== undefined) {
      observe(`engine failures == ${expects.engine_failures}`,
        this.diagnostics.operation_counters.engine_failures === expects.engine_failures,
        this.diagnostics.operation_counters.engine_failures);
    }
    if (expects.failure_status !== undefined) {
      const observed_status = this.diagnostics.first_failure?.status ??
        this.diagnostics.ordered_events().filter(event => event.category === 'engine' && event.severity === 'error')
          .map(event => (event.detail?.failure_status as string | undefined) ?? null).find(status => status !== null) ?? null;
      observe(`failure status ${expects.failure_status}`, observed_status === expects.failure_status, observed_status);
    }
    if (expects.input_rejected_batches !== undefined) {
      observe(`rejected input batches == ${expects.input_rejected_batches}`,
        this.diagnostics.operation_counters.input_rejected_batches === expects.input_rejected_batches,
        this.diagnostics.operation_counters.input_rejected_batches);
    }
    if (expects.mapped_time_ms !== undefined) {
      const mapped_by_sequence = new Map(this.diagnostics.ordered_inputs().map(input => [input.sequence, input.mapped_time_ms]));
      for (const expected of expects.mapped_time_ms) {
        observe(`input ${expected.sequence} maps to ${expected.mapped_time_ms} ms`,
          mapped_by_sequence.get(expected.sequence) === expected.mapped_time_ms, mapped_by_sequence.get(expected.sequence) ?? null);
      }
    }
    if (expects.input_action_bits !== undefined) {
      const action_bits = this.diagnostics.ordered_inputs().map(input => input.action_bits);
      observe(`recorded action bits ${JSON.stringify(expects.input_action_bits)}`,
        JSON.stringify(action_bits) === JSON.stringify(expects.input_action_bits), action_bits);
    }
    if (expects.attempts !== undefined) {
      observe(`attempts == ${expects.attempts}`, this.diagnostics.attempt === expects.attempts, this.diagnostics.attempt);
    }
    if (expects.audio_starts !== undefined) {
      const observed = this.synthetic ? this.synthetic.observations.starts.length : this.audio_starts;
      observe(`audio starts >= ${expects.audio_starts}`, observed >= expects.audio_starts, observed);
    }
    if (expects.audio_interruptions !== undefined) {
      observe(`audio interruptions == ${expects.audio_interruptions}`,
        this.diagnostics.operation_counters.audio_interruptions === expects.audio_interruptions,
        this.diagnostics.operation_counters.audio_interruptions);
    }
    if (expects.graphics_restorations !== undefined) {
      observe(`graphics restorations >= ${expects.graphics_restorations}`,
        this.diagnostics.operation_counters.graphics_restorations >= expects.graphics_restorations,
        this.diagnostics.operation_counters.graphics_restorations);
    }
    if (expects.clock_rebindings !== undefined) {
      observe(`clock rebindings == ${expects.clock_rebindings}`,
        this.diagnostics.operation_counters.clock_rebindings === expects.clock_rebindings,
        this.diagnostics.operation_counters.clock_rebindings);
    }
    return results;
  }

  dispose() {
    try { this.frame?.stop(); } catch { /* Stopped frames are already inert. */ }
    this.frame_callbacks.clear();
    this.renderer?.dispose();
    this.playback?.dispose();
    if (this.session_handle) { try { this.engine?.release_session(this.session_handle); } catch { /* Already released. */ } }
    if (this.map_handle) { try { this.engine?.release_map(this.map_handle); } catch { /* Already released. */ } }
    this.engine?.dispose();
    if (this.real_context) void this.real_context.close().catch(() => {});
  }
}

const IDENTITY_TRANSFORM = [1, 0, 0, 1, -0, -0];

// Real context-loss events arrive asynchronously; bounded waits keep scenario
// runs deterministic in wall time while honoring the browser event sequence.
function wait_for_graphics_event(target: EventTarget, event_name: string, timeout_ms = 1000) {
  return new Promise<void>(resolve => {
    const finish = () => {
      target.removeEventListener(event_name, finish);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeout_ms);
    target.addEventListener(event_name, finish);
  });
}

function capacity_guard(capacity: number | undefined) {
  return capacity ?? 64;
}

function state_name(state: number | null) {
  return ['READY', 'RUNNING', 'PAUSED', 'PASSED', 'FAILED'][state ?? -1] ?? String(state);
}

export async function run_debug_scenario(wasm_bytes: Uint8Array, definition: Debug_Scenario_Definition,
  options: Scenario_Run_Options = {}): Promise<Scenario_Run_Summary> {
  const run = await Debug_Scenario_Run.create(wasm_bytes, definition, options);
  try {
    return await run.run_to_completion();
  } finally {
    run.dispose();
  }
}
