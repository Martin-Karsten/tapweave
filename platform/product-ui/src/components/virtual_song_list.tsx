import { createSignal, For, onCleanup, onMount, type Component } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';

export interface Song_Row {
  id: number;
  title: string;
  stars: number;
}

export const build_song_rows = (count: number): Song_Row[] =>
  Array.from({ length: count }, (_, row_index) => ({
    id: row_index,
    title: `difficulty entry ${row_index}`,
    stars: 1 + ((row_index * 7) % 10) / 2,
  }));

interface Virtual_Song_List_Props {
  rows: Song_Row[];
  row_height: number;
}

export const Virtual_Song_List: Component<Virtual_Song_List_Props> = (props) => {
  let scroll_element: HTMLDivElement | null = null;
  const [selected_index, set_selected_index] = createSignal(0);

  const virtualizer = createVirtualizer({
    count: props.rows.length,
    getScrollElement: () => scroll_element,
    estimateSize: () => props.row_height,
    overscan: 10,
  });

  const move_selection = (target_index: number) => {
    const bounded_index = Math.min(props.rows.length - 1, Math.max(0, target_index));
    set_selected_index(bounded_index);
    virtualizer.scrollToIndex(bounded_index);
  };

  const handle_keydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move_selection(selected_index() + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move_selection(selected_index() - 1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      move_selection(selected_index() + 20);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      move_selection(selected_index() - 20);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move_selection(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move_selection(props.rows.length - 1);
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handle_keydown);
    onCleanup(() => window.removeEventListener('keydown', handle_keydown));
  });

  return (
    <div
      ref={(element) => {
        scroll_element = element;
      }}
      data-virtual-list="songs"
      tabindex="0"
      style={{ height: '320px', 'overflow-y': 'auto', position: 'relative' }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        <For each={virtualizer.getVirtualItems()}>
          {(virtual_row) => (
            <div
              data-index={virtual_row.index}
              data-selected={selected_index() === virtual_row.index}
              style={{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: `${virtual_row.size}px`,
                transform: `translateY(${virtual_row.start}px)`,
                'line-height': `${props.row_height}px`,
                'border-bottom': '1px solid #2e2e44',
              }}
            >
              {props.rows[virtual_row.index].title} — {props.rows[virtual_row.index].stars.toFixed(1)}★
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
