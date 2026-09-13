import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { beforeAll, describe, expect, it } from 'vitest';
import { Virtual_List } from '../src/components/virtual_list';

// happy-dom performs no layout: offset/client/scroll sizes stay zero,
// ResizeObserver never fires and scrollTop assignments clamp to zero range.
// Give the virtualizer a realistic viewport and working programmatic
// scrolling. (Some getters live on HTMLElement.prototype, shadowing Element.)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 320 });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 480 });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 320 });
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => 1_000_000 });
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 1_000_000 });
  const scroll_top_storage = new WeakMap<Element, number>();
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scroll_top_storage.get(this) ?? 0;
    },
    set(top: number) {
      scroll_top_storage.set(this, top);
    },
  });
  const patched_scroll_to = function patched_scroll_to(this: Element, first_argument?: number | ScrollToOptions, second_argument?: number) {
    const top = typeof first_argument === 'number' ? first_argument : (first_argument?.top ?? second_argument ?? 0);
    this.scrollTop = top;
    this.dispatchEvent(new Event('scroll'));
  };
  Element.prototype.scrollTo = patched_scroll_to;
  HTMLElement.prototype.scrollTo = patched_scroll_to;
});

interface Test_Row {
  id: number;
  label: string;
}

const build_rows = (count: number): Test_Row[] =>
  Array.from({ length: count }, (_, row_index) => ({ id: row_index, label: `entry ${row_index}` }));

const render_list = (rows: Test_Row[], on_activate: (row_index: number) => void = () => {}, disabled = false) =>
  render(() => (
    <Virtual_List
      rows={rows}
      row_height={44}
      list_name="test-entries"
      aria_label="Test entries"
      disabled={disabled}
      render_row={(row) => row.label}
      on_activate={on_activate}
    />
  ));

describe('Virtual_List (B2 gate component)', () => {
  it('renders a bounded row window for large row sets', () => {
    const { container } = render_list(build_rows(10_000));
    const rendered_rows = container.querySelectorAll('[data-index]');
    expect(rendered_rows.length).toBeGreaterThan(0);
    expect(rendered_rows.length).toBeLessThan(100);
  });

  it('activates rows on click and reports the selected index', () => {
    const activations: number[] = [];
    const { container } = render_list(build_rows(30), (row_index) => activations.push(row_index));
    fireEvent.click(container.querySelector('[data-index="3"]')!);
    expect(activations).toEqual([3]);
    expect(container.querySelector('[data-selected="true"]')!.getAttribute('data-index')).toBe('3');
  });

  it('moves selection with the keyboard and jumps to the last row with End', async () => {
    const { container } = render_list(build_rows(30));
    const list_element = container.querySelector('[data-virtual-list="test-entries"]')!;
    fireEvent.keyDown(list_element, { key: 'ArrowDown' });
    expect(container.querySelector('[data-selected="true"]')!.getAttribute('data-index')).toBe('1');
    fireEvent.keyDown(list_element, { key: 'End' });
    await waitFor(() => {
      expect(container.querySelector('[data-selected="true"]')!.getAttribute('data-index')).toBe('29');
    });
  });

  it('ignores activation while disabled', () => {
    const activations: number[] = [];
    const { container } = render_list(build_rows(30), (row_index) => activations.push(row_index), true);
    fireEvent.click(container.querySelector('[data-index="2"]')!);
    fireEvent.keyDown(container.querySelector('[data-virtual-list="test-entries"]')!, { key: 'ArrowDown' });
    expect(activations).toEqual([]);
  });
});
