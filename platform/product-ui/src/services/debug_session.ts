import { Diagnostics_Service } from '@browser/diagnostics.js';
import { build_debug_report, PINNED_SOURCE_REVISIONS, serialize_debug_report,
  type Debug_Report_Identity } from '@browser/debug-report.js';
import { Debug_Report_Store, IndexedDB_Report_Backend, type Debug_Report_Backend } from '@browser/debug-store.js';
import type { Active_Selection } from '@browser/selection.js';
import type { Engine_Bridge } from '@browser/engine-bridge.js';
import type { Gameplay_View } from '@browser/gameplay-controller.js';
import type { Engine_Diagnostic } from '@browser/abi-records.js';

// Debug suite re-homed from the retired vanilla player (ADR-006): this service
// owns the typed diagnostics service, the IndexedDB report store and the
// report identity builder. It is a plain class without reactivity; the shell
// state layer converts its publishes into throttled signal updates.

export const DEBUG_VIEW_REFRESH_INTERVAL_MS = 250;

export interface Debug_Session_Bindings {
  engine: () => Engine_Bridge | null;
  selection: () => Active_Selection | null;
  audio_context: () => AudioContext | null;
}

export interface Failure_Report_Copy {
  readonly text: string;
  readonly created_iso: string;
}

export interface Manual_Report_Result {
  readonly text: string;
  readonly created_iso: string;
  readonly warning: string | null;
}

export interface Debug_Session_Options {
  backend?: Debug_Report_Backend;
  now_ms?: () => number;
  schedule?: (callback: () => void, delay_ms: number) => void;
}

export function download_text(filename: string, text: string) {
  const object_url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = object_url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(object_url), 1000);
}

export async function copy_text(text: string, fallback_control: HTMLElement | null, status: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    status('Copied.');
  } catch {
    if (fallback_control instanceof HTMLTextAreaElement || fallback_control instanceof HTMLInputElement) {
      fallback_control.focus();
      fallback_control.select();
      status('Report selected. Press Ctrl+C or Command+C to copy.');
    } else {
      status('Clipboard unavailable.');
    }
  }
}

const digest_hex = (summary: { prepared_digest_0: bigint; prepared_digest_1: bigint;
  prepared_digest_2: bigint; prepared_digest_3: bigint }) =>
  [summary.prepared_digest_0, summary.prepared_digest_1, summary.prepared_digest_2, summary.prepared_digest_3]
    .map(part => part.toString(16).padStart(16, '0')).join('');

export class Debug_Session_Service {
  readonly diagnostics = new Diagnostics_Service();
  private readonly store: Debug_Report_Store;
  private readonly now_ms: () => number;
  private readonly schedule_publish: (callback: () => void, delay_ms: number) => void;
  private readonly view_listeners = new Set<() => void>();
  private bindings: Debug_Session_Bindings = { engine: () => null, selection: () => null, audio_context: () => null };
  private publish_scheduled = false;
  private last_publish_ms: number | null = null;
  private persisted_recovery_at: string | null = null;
  private selected_filename: string | null = null;
  private failure_report_copy: Failure_Report_Copy | null = null;
  private failure_persist_promise: Promise<void> | null = null;

  constructor(options: Debug_Session_Options = {}) {
    this.store = new Debug_Report_Store(options.backend ?? new IndexedDB_Report_Backend());
    this.now_ms = options.now_ms ?? (() => performance.now());
    this.schedule_publish = options.schedule ?? ((callback, delay_ms) => {
      setTimeout(callback, delay_ms);
    });
  }

  bind(bindings: Debug_Session_Bindings) {
    this.bindings = bindings;
  }

  record_engine_log(message: Engine_Diagnostic) {
    this.diagnostics.record_event('engine', 'info', 'engine_log', message.message,
      { file_descriptor: message.file_descriptor });
  }

  note_player_started() {
    this.diagnostics.note_operation('player_start');
    this.diagnostics.note_lifecycle('Validation player started.');
  }

  // Frame-driver callback: a timestamp check only. View updates are published
  // by a timer outside this call, so no listener (and no signal write) runs in
  // the frame path. Refresh cadence stays at most four publishes per second.
  note_frame_tick() {
    this.request_view_publish(this.now_ms());
  }

  subscribe_view(listener: () => void): () => void {
    this.view_listeners.add(listener);
    return () => this.view_listeners.delete(listener);
  }

  private request_view_publish(now_ms: number) {
    if (this.publish_scheduled) return;
    this.publish_scheduled = true;
    const remaining_ms = this.last_publish_ms === null ? 0 :
      Math.max(0, DEBUG_VIEW_REFRESH_INTERVAL_MS - (now_ms - this.last_publish_ms));
    this.schedule_publish(() => {
      this.publish_scheduled = false;
      this.last_publish_ms = this.now_ms();
      for (const listener of [...this.view_listeners]) listener();
    }, remaining_ms);
  }

  // Called from the session service publish path (lifecycle transitions, never
  // the frame driver): records selection events, builds the automatic failure
  // report once per recovery and marks the debug views dirty.
  note_gameplay_view(view: Gameplay_View, active: Active_Selection | null) {
    if (active !== null && active.filename !== this.selected_filename) {
      this.selected_filename = active.filename;
      this.diagnostics.record_event('resource', 'info', 'map_selected', `Selected ${active.filename}.`,
        { filename: active.filename, objects_count: active.descriptor.summary.objects_count,
          music: active.music_status });
    } else if (active === null) {
      this.selected_filename = null;
    }
    if (view.recovery !== null) {
      const captured_at = String(view.recovery.captured_at);
      if (this.persisted_recovery_at !== captured_at) {
        this.persisted_recovery_at = captured_at;
        const report = build_debug_report(this.diagnostics, this.report_identity(), 'failure');
        const text = serialize_debug_report(report);
        this.failure_report_copy = { text, created_iso: report.created_iso };
        this.failure_persist_promise = this.store.persist(text,
          { created_iso: report.created_iso, reason: 'failure', capture_mode: report.capture_mode,
            failure_operation: report.failure ? `${report.failure.operation}: ${report.failure.message}` : null })
          .then(result => {
            if (result.warning) {
              this.diagnostics.record_event('resource', 'warning', 'report_storage', result.warning);
            }
          });
      }
    } else {
      this.persisted_recovery_at = null;
      this.failure_report_copy = null;
      this.failure_persist_promise = null;
    }
    this.request_view_publish(this.now_ms());
  }

  get failure_report(): Failure_Report_Copy | null {
    return this.failure_report_copy;
  }

  get failure_persistence(): Promise<void> | null {
    return this.failure_persist_promise;
  }

  report_identity(): Debug_Report_Identity {
    const engine = this.bindings.engine();
    const active = this.bindings.selection();
    const audio_context = this.bindings.audio_context();
    const summary = active?.descriptor.summary;
    const notes: string[] = [];
    notes.push('GPU interval timings are asynchronous; unavailable or disjoint results are shown as unavailable.');
    if (engine?.wasm_sha256 == null) notes.push('WASM module digest was not captured.');
    return {
      engine: engine ? { build_id: engine.capabilities.build_id.toString(), behavior_id: engine.capabilities.behavior_id,
        numeric_mode: engine.capabilities.numeric_mode, abi: `${engine.capabilities.abi_major}.${engine.capabilities.abi_minor}`,
        lazer_version: engine.capabilities.lazer_version, raw_bytes_limit: engine.capabilities.raw_bytes.toString(),
        arena_bytes_limit: engine.capabilities.arena_bytes.toString() } : null,
      wasm_sha256: engine?.wasm_sha256 ?? null,
      sources: PINNED_SOURCE_REVISIONS,
      map: summary ? { filename: active!.filename, format_version: summary.format_version,
        objects_count: summary.objects_count, hp: summary.hp, cs: summary.cs, od: summary.od, ar: summary.ar,
        prepared_digest: digest_hex(summary), music: active!.music_status } : null,
      browser: { user_agent: navigator.userAgent, platform: (navigator as { platform?: string }).platform ?? null,
        language: navigator.language, hardware_concurrency: navigator.hardwareConcurrency ?? null,
        device_memory_gb: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
        max_touch_points: navigator.maxTouchPoints ?? null, pixel_ratio: window.devicePixelRatio,
        view: `${window.innerWidth}x${window.innerHeight}` },
      audio: audio_context ? { state: audio_context.state, sample_rate: audio_context.sampleRate,
        base_latency_seconds: audio_context.baseLatency, output_latency_seconds: audio_context.outputLatency } : null,
      capabilities: engine ? { simulation_flags: engine.simulation_capabilities.flags,
        simulation_max_inputs: engine.simulation_capabilities.max_inputs, output_flags: engine.output_capabilities.flags,
        transport_flags: engine.transport_capabilities.flags,
        voice_command_mask: engine.transport_capabilities.voice_command_mask } : null,
      notes,
    };
  }

  set_detailed_capture(enabled: boolean) {
    this.diagnostics.capture_mode = enabled ? 'detailed' : 'basic';
    this.diagnostics.record_event('lifecycle', 'info', 'capture_mode',
      `Capture mode set to ${this.diagnostics.capture_mode}.`);
  }

  async export_manual_report(): Promise<Manual_Report_Result> {
    const report = build_debug_report(this.diagnostics, this.report_identity(), 'manual');
    const text = serialize_debug_report(report);
    const result = await this.store.persist(text,
      { created_iso: report.created_iso, reason: 'manual', capture_mode: report.capture_mode,
        failure_operation: report.failure ? `${report.failure.operation}: ${report.failure.message}` : null });
    download_text(`tapweave-report-${report.created_iso.replace(/[:.]/g, '-')}.json`, text);
    return { text, created_iso: report.created_iso, warning: result.warning };
  }

  async stored_reports() {
    return this.store.list();
  }

  async stored_text(key: string) {
    return this.store.text(key);
  }

  async remove_stored(key: string) {
    return this.store.remove(key);
  }

  get store_warning() {
    return this.store.warning;
  }
}
