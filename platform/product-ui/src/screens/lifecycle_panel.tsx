import { For, Show, type Component } from 'solid-js';
import { HIT_RESULT_NAMES, RANK_NAMES } from '@browser/abi-records.js';
import type { Gameplay_View } from '@browser/gameplay-controller.js';
import type { Session_Output } from '@browser/engine-bridge.js';

const lifecycle_title = (view: Gameplay_View): string => {
  if (view.state === 'terminal') return view.message;
  if (view.state === 'recovering') return 'Playback interrupted';
  if (view.state === 'starting') return 'Starting…';
  return 'Paused';
};

const result_items = (result: Session_Output): [string, string][] => {
  const summary = result.summary;
  const items: [string, string][] = [['Score', String(summary.score)], ['Accuracy', `${(Number(summary.accuracy) * 100).toFixed(2)}%`],
    ['Rank', RANK_NAMES[Number(summary.rank)] ?? String(summary.rank)], ['Max combo', String(summary.highest_combo)]];
  for (const count of result.result_counts()) {
    if (Number(count.actual) || Number(count.maximum)) {
      items.push([HIT_RESULT_NAMES[Number(count.result)] ?? `Result ${count.result}`, String(count.actual)]);
    }
  }
  return items;
};

interface Lifecycle_Panel_Props {
  view: Gameplay_View;
  on_resume: () => void;
  on_retry: () => void;
  on_back: () => void;
}

// Shared pause/recovery/results overlay. Keeps the vanilla player's focus
// semantics: Tab cycles the enabled buttons inside the panel.
export const Lifecycle_Panel: Component<Lifecycle_Panel_Props> = (props) => {
  let panel_element: HTMLElement | null = null;

  const trap_tab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || panel_element === null) return;
    const buttons = [...panel_element.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => !button.hidden && !button.disabled);
    if (!buttons.length) return;
    const focused_index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (focused_index < 0 || (!event.shiftKey && focused_index === buttons.length - 1) ||
      (event.shiftKey && focused_index === 0)) {
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
    }
  };

  return (
    <section
      ref={(element) => {
        panel_element = element;
      }}
      id="lifecycle-panel"
      tabindex="-1"
      aria-labelledby="lifecycle-title"
      onKeyDown={trap_tab}
      class="lifecycle-panel"
    >
      <h2 id="lifecycle-title">{lifecycle_title(props.view)}</h2>
      <p id="lifecycle-message" role="status" aria-live="polite">
        {props.view.state === 'terminal' ? 'Run complete. Retry or return to selection.' : props.view.message}
      </p>
      <dl id="result-stats" hidden={!props.view.result}>
        <Show when={props.view.result}>
          <For each={result_items(props.view.result!)}>
            {([label, text]) => (
              <div>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            )}
          </For>
        </Show>
      </dl>
      <button id="resume" type="button" hidden={props.view.state !== 'paused'} disabled={!props.view.can_resume} onClick={props.on_resume}>
        Resume
      </button>
      <button id="retry" type="button" disabled={!props.view.can_retry} onClick={props.on_retry}>
        Retry
      </button>
      <button id="back" type="button" onClick={props.on_back}>
        Back to selection
      </button>
    </section>
  );
};
