import { describe, expect, it } from 'vitest';
import { In_Memory_Report_Backend } from '@browser/debug-store.js';
import type { Active_Selection } from '@browser/selection.js';
import type { Engine_Bridge } from '@browser/engine-bridge.js';
import type { Gameplay_View } from '@browser/gameplay-controller.js';
import {
  DEBUG_VIEW_REFRESH_INTERVAL_MS,
  Debug_Session_Service,
} from '../src/services/debug_session';

const engine_stub = (wasm_sha256: string | null): Engine_Bridge =>
  ({
    wasm_sha256,
    capabilities: { build_id: 0x54575057454e24n, behavior_id: 1, numeric_mode: 2, abi_major: 2, abi_minor: 1,
      lazer_version: 2026804, raw_bytes: 67108864n, arena_bytes: 33554432n },
    simulation_capabilities: { flags: 1, max_inputs: 8192 },
    output_capabilities: { flags: 0 },
    transport_capabilities: { flags: 0, voice_command_mask: 15 },
  }) as unknown as Engine_Bridge;

const selection_stub = (filename: string): Active_Selection =>
  ({
    filename,
    music_status: 'decoded',
    descriptor: { summary: { format_version: 14, objects_count: 3, hp: 0, cs: 4, od: 8, ar: 9,
      prepared_digest_0: 0x0001020304050607n, prepared_digest_1: 0x08090a0b0c0d0e0fn,
      prepared_digest_2: 0xf0e0d0c0b0a09080n, prepared_digest_3: 0x7060504030201000n } },
  }) as unknown as Active_Selection;

const audio_context_stub = () =>
  ({ state: 'running', sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.012 }) as unknown as AudioContext;

const gameplay_view = (recovery: Readonly<Record<string, unknown>> | null): Gameplay_View =>
  ({ state: recovery === null ? 'ready' : 'recovering', can_play: recovery === null, can_resume: false,
    can_retry: recovery !== null, recovery, in_attempt: recovery !== null,
    message: 'observed', error: null, result: null }) as unknown as Gameplay_View;

describe('Debug_Session_Service identity building', () => {
  it('serializes engine caps, digest, map summary and browser metadata', () => {
    const service = new Debug_Session_Service({ backend: new In_Memory_Report_Backend() });
    service.bind({ engine: () => engine_stub('a'.repeat(64)), selection: () => selection_stub('mixed.osu'),
      audio_context: () => audio_context_stub() });
    const identity = service.report_identity();
    expect(identity.engine).toMatchObject({ build_id: (0x54575057454e24n).toString(),
      abi: '2.1', lazer_version: 2026804 });
    expect(identity.wasm_sha256).toBe('a'.repeat(64));
    expect(identity.map).toMatchObject({ filename: 'mixed.osu', objects_count: 3, music: 'decoded' });
    expect(identity.map?.prepared_digest).toBe('000102030405060708090a0b0c0d0e0ff0e0d0c0b0a090807060504030201000');
    expect(identity.sources.osu.commit).toBe('3c1c96f742e7aae2ff67a7361e058fe91ca3b955');
    expect(identity.audio).toMatchObject({ state: 'running', sample_rate: 48000 });
    expect(identity.capabilities).toMatchObject({ simulation_max_inputs: 8192, voice_command_mask: 15 });
    expect(identity.notes).toHaveLength(1);
  });

  it('reports null identity pieces and notes a missing wasm digest honestly', () => {
    const service = new Debug_Session_Service({ backend: new In_Memory_Report_Backend() });
    service.bind({ engine: () => engine_stub(null), selection: () => null, audio_context: () => null });
    const identity = service.report_identity();
    expect(identity.engine).not.toBeNull();
    expect(identity.wasm_sha256).toBeNull();
    expect(identity.map).toBeNull();
    expect(identity.audio).toBeNull();
    expect(identity.notes).toContain('WASM module digest was not captured.');
  });
});

describe('Debug_Session_Service view publish throttle', () => {
  const build_throttled_service = () => {
    let clock_ms = 0;
    const scheduled: { callback: () => void; delay_ms: number }[] = [];
    const service = new Debug_Session_Service({
      backend: new In_Memory_Report_Backend(),
      now_ms: () => clock_ms,
      schedule: (callback, delay_ms) => scheduled.push({ callback, delay_ms }),
    });
    return {
      service,
      scheduled,
      advance: (step_ms: number) => {
        clock_ms += step_ms;
      },
      flush: () => {
        const pending = scheduled.splice(0, scheduled.length);
        for (const entry of pending) entry.callback();
      },
    };
  };

  it('publishes immediately for the first tick and never more than four times per second', () => {
    const harness = build_throttled_service();
    const publish_count = { value: 0 };
    harness.service.subscribe_view(() => {
      publish_count.value++;
    });
    harness.service.note_frame_tick();
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.scheduled[0].delay_ms).toBe(0);
    harness.flush();
    expect(publish_count.value).toBe(1);

    harness.advance(100);
    harness.service.note_frame_tick();
    expect(harness.scheduled[0].delay_ms).toBe(DEBUG_VIEW_REFRESH_INTERVAL_MS - 100);
    // Further ticks inside the throttle window must not schedule again.
    harness.advance(10);
    harness.service.note_frame_tick();
    harness.service.note_frame_tick();
    expect(harness.scheduled).toHaveLength(1);
    harness.flush();
    expect(publish_count.value).toBe(2);
  });

  it('coalesces a burst of frame ticks into one publish', () => {
    const harness = build_throttled_service();
    const publish_count = { value: 0 };
    harness.service.subscribe_view(() => {
      publish_count.value++;
    });
    for (let tick_index = 0; tick_index < 30; tick_index++) {
      harness.advance(8);
      harness.service.note_frame_tick();
    }
    harness.flush();
    expect(publish_count.value).toBe(1);
  });
});

describe('Debug_Session_Service failure-report lifecycle', () => {
  it('builds and persists one failure report per recovery capture', async () => {
    const backend = new In_Memory_Report_Backend();
    const service = new Debug_Session_Service({ backend, now_ms: () => 0, schedule: () => {} });
    service.bind({ engine: () => engine_stub('b'.repeat(64)), selection: () => selection_stub('mixed.osu'),
      audio_context: () => audio_context_stub() });

    service.note_gameplay_view(gameplay_view({ captured_at: '2026-09-14T10:00:00.000Z' }), selection_stub('mixed.osu'));
    const first_persist = service.failure_persistence;
    expect(first_persist).not.toBeNull();
    await first_persist;
    expect(backend.entries.size).toBe(1);
    const first_entry = [...backend.entries.values()][0];
    expect(first_entry.reason).toBe('failure');
    // No engine failure was recorded in this synthetic scenario, so the report
    // carries no failure operation; recovery-triggered rebuilds still persist.
    expect(first_entry.failure_operation).toBeNull();
    expect(service.failure_report?.created_iso).toBe(first_entry.created_iso);
    const first_report_text = service.failure_report?.text ?? '';
    expect(JSON.parse(first_report_text).reason).toBe('failure');

    // The same recovery capture republished (further lifecycle publishes) must
    // not rebuild or re-persist the report.
    service.note_gameplay_view(gameplay_view({ captured_at: '2026-09-14T10:00:00.000Z' }), selection_stub('mixed.osu'));
    await service.failure_persistence;
    expect(backend.entries.size).toBe(1);

    // A second recovery is a new report.
    service.note_gameplay_view(gameplay_view({ captured_at: '2026-09-14T10:01:00.000Z' }), selection_stub('mixed.osu'));
    await service.failure_persistence;
    expect(backend.entries.size).toBe(2);

    // Clearing the recovery resets the keying so a later recovery persists again.
    service.note_gameplay_view(gameplay_view(null), selection_stub('mixed.osu'));
    expect(service.failure_report).toBeNull();
    expect(service.failure_persistence).toBeNull();
    service.note_gameplay_view(gameplay_view({ captured_at: '2026-09-14T10:02:00.000Z' }), selection_stub('mixed.osu'));
    await service.failure_persistence;
    expect(backend.entries.size).toBe(3);
  });

  it('records map selection events once per distinct map', () => {
    const backend = new In_Memory_Report_Backend();
    const service = new Debug_Session_Service({ backend, now_ms: () => 0, schedule: () => {} });
    const selection = selection_stub('mixed.osu');
    service.note_gameplay_view(gameplay_view(null), selection);
    service.note_gameplay_view(gameplay_view(null), selection);
    const selection_events = service.diagnostics.ordered_events()
      .filter(event => event.operation === 'map_selected');
    expect(selection_events).toHaveLength(1);
    expect(selection_events[0].message).toBe('Selected mixed.osu.');
  });
});
