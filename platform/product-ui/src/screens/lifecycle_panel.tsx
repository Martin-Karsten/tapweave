import { For, Show, createSignal, type Component } from 'solid-js';
import { HIT_RESULT_NAMES, RANK_NAMES } from '@browser/abi-records.js';
import type { Gameplay_View } from '@browser/gameplay-controller.js';
import type { Session_Output } from '@browser/engine-bridge.js';
import { debug_session, open_debug_dialog } from '../state/debug_state';
import { copy_text, download_text } from '../services/debug_session';

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
  // Terminal-only result actions; the results screen supplies them, transient
  // play-route overlays do not.
  on_watch_replay?: () => void;
  on_save_replay?: () => void;
}

// Shared pause/recovery/results overlay. Keeps the vanilla player's focus
// semantics: Tab cycles the enabled buttons (and the recovery report) inside
// the panel. Recovery views auto-build a copyable failure report once.
export const Lifecycle_Panel: Component<Lifecycle_Panel_Props> = (props) => {
  let panel_element: HTMLElement | null = null;
  let recovery_textarea: HTMLTextAreaElement | null = null;
  const [copy_status, set_copy_status] = createSignal('');

  const failure_report = () => debug_session()?.failure_report ?? null;

  const copy_recovery_report = async () => {
    await copy_text(recovery_textarea?.value ?? '', recovery_textarea, set_copy_status);
  };

  const download_recovery_report = () => {
    const report = failure_report();
    if (!report) return;
    download_text(`tapweave-report-${report.created_iso.replace(/[:.]/g, '-')}.json`, report.text);
  };

  const trap_tab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || panel_element === null) return;
    const controls = [...panel_element.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea')]
      .filter((control) => !control.hidden && !control.closest('[hidden]') && !control.disabled);
    if (!controls.length) return;
    const focused_index = controls.indexOf(document.activeElement as HTMLButtonElement | HTMLTextAreaElement);
    if (focused_index < 0 || (!event.shiftKey && focused_index === controls.length - 1) ||
      (event.shiftKey && focused_index === 0)) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
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
      <Show when={props.view.recovery}>
        <div id="recovery-diagnostics">
          <label for="recovery-report">Copy this diagnostic report when reporting the interruption.</label>
          <textarea
            ref={(element) => {
              recovery_textarea = element;
            }}
            id="recovery-report"
            readonly
            spellcheck={false}
            rows={10}
            value={failure_report()?.text ?? ''}
          />
          <button id="copy-recovery" type="button" onClick={() => void copy_recovery_report()}>
            Copy diagnostic report
          </button>
          <button id="download-recovery" type="button" onClick={download_recovery_report}>
            Download report
          </button>
          <span id="copy-status" role="status">{copy_status()}</span>
        </div>
      </Show>
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
      <Show when={props.view.state === 'terminal' && props.view.result && props.on_watch_replay && props.on_save_replay}>
        <button id="watch-replay" type="button" disabled={!props.view.can_watch_replay} onClick={props.on_watch_replay}>
          Watch replay
        </button>
        <button id="save-replay" type="button" onClick={props.on_save_replay}>
          Save replay
        </button>
      </Show>
      <button id="resume" type="button" hidden={props.view.state !== 'paused'} disabled={!props.view.can_resume} onClick={props.on_resume}>
        Resume
      </button>
      <button id="retry" type="button" disabled={!props.view.can_retry} onClick={props.on_retry}>
        Retry
      </button>
      <button id="debug-open-lifecycle" type="button" onClick={open_debug_dialog}>
        Debug
      </button>
      <button id="back" type="button" onClick={props.on_back}>
        Back to selection
      </button>
    </section>
  );
};
