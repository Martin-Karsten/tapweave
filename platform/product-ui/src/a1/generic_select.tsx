import { createSignal, For, Show, type Component, type JSX } from 'solid-js';

export interface Song_Entry {
  id: number;
  title: string;
}

interface Generic_Select_Props<T> {
  items: readonly T[];
  label: string;
  on_select: (item: T) => void;
}

export function Generic_Select<T extends { id: number }>(props: Generic_Select_Props<T>): JSX.Element {
  const [selected_id, set_selected_id] = createSignal<number | null>(null);
  return (
    <section data-label={props.label}>
      <For each={props.items} fallback={<p data-empty="true">no entries</p>}>
        {(item) => (
          <button
            type="button"
            data-selected={selected_id() === item.id}
            onClick={() => {
              set_selected_id(item.id);
              props.on_select(item);
            }}
          >
            {item.id}
          </button>
        )}
      </For>
      <Show when={selected_id() !== null} fallback={<p data-empty-selection="true">nothing selected</p>}>
        <p data-selected-id={selected_id()}>chosen</p>
      </Show>
    </section>
  );
}

export const Typed_Host: Component<{ songs: Song_Entry[] }> = (props) => {
  return <Generic_Select items={props.songs} label="songs" on_select={(song) => song.title.toUpperCase()} />;
};
