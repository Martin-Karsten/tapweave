import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { boot_engine, capabilities_view, type Engine_Capabilities_View } from '../services/engine_boot';

export const Engine_Diagnostics_Panel: Component = () => {
  const [boot, { refetch }] = createResource(boot_engine);
  const [memory_pages, set_memory_pages] = createSignal<number | null>(null);

  const view = (): Engine_Capabilities_View | null => {
    const result = boot();
    return result ? capabilities_view(result.engine) : null;
  };

  return (
    <div data-b1-panel="engine">
      <Show
        when={view()}
        fallback={
          <Show when={boot.error} fallback={<p data-b1-state="loading">booting engine…</p>}>
            <p data-b1-state="error">{String(boot.error)}</p>
          </Show>
        }
      >
        {(capabilities) => (
          <div>
            <p data-b1-state="ready">
              engine ready — build {capabilities().build_id} · behavior {capabilities().behavior_id} · ABI{' '}
              {capabilities().abi} · lazer {capabilities().lazer_version} · {capabilities().numeric_mode}
            </p>
            <dl>
              <For
                each={[
                  ['preparation_version', capabilities().preparation_version],
                  ['simulation_flags', capabilities().simulation_flags],
                  ['simulation_max_inputs', capabilities().simulation_max_inputs],
                  ['output_flags', capabilities().output_flags],
                  ['transport_flags', capabilities().transport_flags],
                  ['voice_command_mask', capabilities().voice_command_mask],
                  ['raw_bytes_limit', capabilities().raw_bytes_limit],
                  ['arena_bytes_limit', capabilities().arena_bytes_limit],
                ]}
              >
                {([field_name, field_value]) => (
                  <div data-capability-field={field_name}>
                    <dt>{field_name}</dt>
                    <dd data-capability-value={String(field_value)}>{String(field_value)}</dd>
                  </div>
                )}
              </For>
            </dl>
            <p data-b1-wasm-pages={memory_pages() ?? capabilities().wasm_pages}>
              wasm pages: {memory_pages() ?? capabilities().wasm_pages}
            </p>
            <button
              type="button"
              onClick={() => {
                const result = boot();
                if (result) {
                  set_memory_pages(result.engine.wasm.memory.buffer.byteLength / 65536);
                }
              }}
            >
              re-read live wasm memory
            </button>
          </div>
        )}
      </Show>
      <button type="button" onClick={() => refetch()}>
        reboot engine
      </button>
    </div>
  );
};
