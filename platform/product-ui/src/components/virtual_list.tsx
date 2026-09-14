import { For, createSignal, type Component, type JSX } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';

interface Virtual_List_Props<Row> {
  rows: readonly Row[];
  row_height: number;
  list_name: string;
  aria_label: string;
  disabled?: boolean;
  render_row: (row: Row, row_index: number) => JSX.Element;
  on_activate: (row_index: number) => void;
}

// Generalized B2 gate component: bounded DOM for arbitrarily large row sets.
// Keyboard navigation follows the validated gate behavior (arrows, PageUp/Down,
// Home/End) with selection scrolling, scoped to the focused listbox so other
// controls keep their own keyboard semantics.
export function Virtual_List<Row>(props: Virtual_List_Props<Row>): JSX.Element {
  let scroll_element: HTMLDivElement | null = null;
  const [selected_index, set_selected_index] = createSignal(0);

  const virtualizer = createVirtualizer({
    get count() {
      return props.rows.length;
    },
    getScrollElement: () => scroll_element,
    estimateSize: () => props.row_height,
    overscan: 10,
  });

  const move_selection = (target_index: number) => {
    const bounded_index = Math.min(props.rows.length - 1, Math.max(0, target_index));
    set_selected_index(bounded_index);
    virtualizer.scrollToIndex(bounded_index);
  };

  const activate = (row_index: number) => {
    if (props.disabled) return;
    move_selection(row_index);
    props.on_activate(row_index);
  };

  const handle_keydown = (event: KeyboardEvent) => {
    if (props.disabled) return;
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
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(selected_index());
    }
  };

  return (
    <div
      ref={(element) => {
        scroll_element = element;
      }}
      data-virtual-list={props.list_name}
      aria-label={props.aria_label}
      tabindex={props.disabled ? -1 : 0}
      onKeyDown={handle_keydown}
      style={{ height: '320px', 'overflow-y': 'auto', position: 'relative' }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        <For each={virtualizer.getVirtualItems()}>
          {(virtual_row) => (
            <div
              role="option"
              aria-selected={selected_index() === virtual_row.index}
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
                cursor: props.disabled ? 'default' : 'pointer',
              }}
              onClick={() => activate(virtual_row.index)}
            >
              {props.render_row(props.rows[virtual_row.index], virtual_row.index)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
